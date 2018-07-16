'use strict'

const test = require('ava')
const express = require('express')
const nock = require('nock')
const fetch = require('node-fetch')
const querystring = require('querystring')
const supertest = require('supertest')

const app = require('../app.js')
const newsblur = require('../routes/newsblur.js')
const secrets = require('../secrets.json')

const datastore = newsblur.datastore

// NewsBlur: https://newsblur.com/api
const nbTokenRequest = {
  grant_type: 'authorization_code',
  code: 'my-nb-code',
  redirect_uri: /http:\/\/.+\/newsblur\/callback/,
  client_id: secrets.newsblur.client_id,
  client_secret: secrets.newsblur.client_secret,
}

const nbTokenResponse = {
  access_token: 'my-nb-token',
  token_type: 'Bearer',
  expires_in: 315360000,
  refresh_token: 'my-nb-refresh-token',
  scope: 'read write ifttt',
}

// NewsBlur: https://newsblur.com/api#/social/profile
const profile = {
  authenticated: true,
  result: 'ok',
  user_id: 180419,
  user_profile: {
    id: 'social:180419',
    user_id: 180419,
    username: 'snarfed',
    'protected': false,
    'private': false,
    website: 'https://snarfed.org',
    feed_link: 'http://snarfed.newsblur.com/',
    feed_address: 'http://www.newsblur.com/social/rss/180419/snarfed',
    bio: '',
    location: '',
    feed_title: "snarfed's blurblog",
    photo_url: 'https://s3.amazonaws.com/avatars.newsblur.com/avatars/180419/thumbnail_profile_1371535876.jpg',
    large_photo_url: 'https://s3.amazonaws.com/avatars.newsblur.com/avatars/180419/large_profile_1371535876.jpg',
  },
  profiles: {},
  activities: ['...'],
}

// NewsBlur: https://newsblur.com/api#/reader/feeds
const nbFeeds = {
  authenticated: true,
  folders: [
    {One: [123, 456]},
    {Two: [789]},
  ],
  feeds: {
    123: {
      id: 123,
      feed_title: "Foo",
      feed_link: "https://example.com/foo",
      feed_address: "https://example.com/foo",
      active: true,
      subscribed: true,
      num_subscribers: 1,
    },
    456: {
      id: 456,
      feed_title: "Bar",
      feed_link: "https://example.com/bar",
      feed_address: "https://example.com/bar",
      active: true,
      subscribed: true,
      num_subscribers: 2,
    },
  },
}

// Microsub: https://indieweb.org/Microsub-spec#Channels_2
const msChannels = {
  'channels': [{
    uid: 'One',
    name: 'One',
    unread: 0,
  }, {
    uid: 'Two',
    name: 'Two',
    unread: 0,
  }, {
    uid: 'notifications',
    name: 'notifications',
    unread: 0,
  }],
}

// NewsBlur: https://newsblur.com/api#/reader/river_stories
const nbStories = {
  authenticated: true,
  stories: [{
    story_id: 'abc987',
    story_permalink: 'http://example.com/post',
    story_date: '2017-01-01 00:00:00',
    story_title: 'My post',
    story_content: 'Writing some <em>HTML</em>.',
    read_status: 0,
    story_tags: ['one', 'two'],
    story_authors: 'Ms. Foo',

    image_urls: ['http://example.com/image.png'],
    story_feed_id: 5917088,
    story_hash: '5917088:47ea23',
    guid_hash: '47ea23',
  }],
}

// Microsub: https://indieweb.org/Microsub-spec#Channels_2
const msTimeline = {
  items: [{
    type: 'entry',
    _id: 'abc987',
    _is_read: false,
    url: 'http://example.com/post',
    name: 'My post',
    content: {'html': 'Writing some <em>HTML</em>.'},
    published: '2017-01-01 00:00:00',
    author: {
      type: 'card',
      name: 'Ms. Foo',
    },
    category: ['one', 'two'],
  }],
  'paging': {
    'after': '2',
  },
}


test.beforeEach.serial('clear datastore', async t => {
  const keys = await datastore.runQuery(
    datastore.createQuery('NewsBlurUser').select('__key__'))

  if (keys.length && keys[0].length)
    await datastore.delete(keys[0].map(k => k[datastore.KEY]))
})

function expectApi(path, response) {
  nock('https://newsblur.com',
       {reqheaders: {'Authorization': 'Bearer my-nb-token',
                     'User-Agent': 'Baffle (https://baffle.tech)'}})
    .get(path)
    .reply(200, response)
}

// https://indieweb.org/token-endpoint#Verifying_an_Access_Token
function expectVerifyToken(status) {
  nock('http://token',
       {reqheaders: {'Authorization': 'Bearer my-ia-token',
                     'User-Agent': 'Baffle (https://baffle.tech)'}})
    .get('/endpoint')
    .reply(status, '')
}

async function addUser() {
  await datastore.save({
    key: datastore.key(['NewsBlurUser', 'snarfed']),
    data: {
      newsblur_token: 'my-nb-token',
      token_endpoint: 'http://token/endpoint',
      profile: profile,
    },
  })
}

test.serial('oauthStart', async t => {
  const res = await supertest(app).post('/newsblur/start')
  t.is(res.statusCode, 302)
  t.regex(querystring.unescape(res.get('Location')),
          /https:\/\/newsblur.com\/oauth\/authorize\?response_type=code&redirect_uri=http:\/\/.+\/newsblur\/callback&client_id=[^&]+/)
})

test.serial('oauthCallback, token endpoint in HTML', async t => {
  nock('https://newsblur.com')
    .post('/oauth/token', nbTokenRequest)
    .reply(200, nbTokenResponse)
  expectApi('/social/profile', profile)
  nock(profile.user_profile.website).get('/').reply(
    200, '<html><body><link rel="token_endpoint" href="http://foo"></body></html>')

  const res = await supertest(app).get('/newsblur/callback?code=my-nb-code')
  t.is(res.statusCode, 200)

  const user = (await datastore.get(datastore.key(['NewsBlurUser', 'snarfed'])))[0]
  t.is(user.newsblur_token, 'my-nb-token')
  t.is(user.token_endpoint, 'http://foo/')
  t.deepEqual(user.profile, profile)
})

test.serial('oauthCallback, token endpoint in HTTP header', async t => {
  nock('https://newsblur.com')
    .post('/oauth/token', nbTokenRequest)
    .reply(200, nbTokenResponse)
  expectApi('/social/profile', profile)
  nock(profile.user_profile.website).get('/').reply(200, 'foo', {
    'Link': ['xyz', "<http://foo>; rel='token_endpoint'"],
  })

  const res = await supertest(app).get('/newsblur/callback?code=my-nb-code')
  t.is(res.statusCode, 200)

  const user = (await datastore.get(datastore.key(['NewsBlurUser', 'snarfed'])))[0]
  t.is(user.newsblur_token, 'my-nb-token')
  t.is(user.token_endpoint, 'http://foo')
  t.deepEqual(user.profile, profile)
})

test.serial('oauthCallback missing website in profile', async t => {
  nock('https://newsblur.com')
    .post('/oauth/token', nbTokenRequest)
    .reply(200, nbTokenResponse)

  let noWebsite = JSON.parse(JSON.stringify(profile))  // deep copy
  noWebsite.user_profile.website = null
  expectApi('/social/profile', noWebsite)

  const res = await supertest(app).get('/newsblur/callback?code=my-nb-code')
  t.is(res.statusCode, 400)
})

test.serial('oauthCallback website missing token endpoint', async t => {
  nock('https://newsblur.com')
    .post('/oauth/token', nbTokenRequest)
    .reply(200, nbTokenResponse)
  expectApi('/social/profile', profile)
  nock(profile.user_profile.website).get('/').reply(
    200, '<html><body>fooey</body></html>')

  const res = await supertest(app).get('/newsblur/callback?code=my-nb-code')
  t.is(res.statusCode, 400)
})

test.serial('unknown action', async t => {
  await addUser()

  expectVerifyToken()
  let res = await supertest(app).get('/newsblur/snarfed')
      .set('Authorization', 'Bearer my-ia-token')
  t.is(res.statusCode, 501)

  expectVerifyToken()
  res = await supertest(app).get('/newsblur/snarfed?action=foo')
      .set('Authorization', 'Bearer my-ia-token')
  t.is(res.statusCode, 501)
})

test.serial('channelActions no user', async t => {
  const res = await supertest(app).get('/newsblur/snarfed?action=channels')
      .set('Authorization', 'Bearer my-ia-token')
  t.is(res.statusCode, 400)
})

test.serial('channelActions no Authorization header', async t => {
  await addUser()
  const res = await supertest(app).get('/newsblur/snarfed?action=channels')
  t.is(res.statusCode, 401)
})

test.serial('channelActions bad Authorization header', async t => {
  await addUser()

  let res = await supertest(app).get('/newsblur/snarfed?action=channels')
      .set('Authorization', 'foo bar')
  t.is(res.statusCode, 400)

  res = await supertest(app).get('/newsblur/snarfed?action=channels')
    .set('Authorization', 'Bearer ')
  t.is(res.statusCode, 400)
})

test.serial("channelActions verify token fails", async t => {
  await addUser()
  expectVerifyToken(403)

  const res = await supertest(app).get('/newsblur/snarfed?action=channels')
      .set('Authorization', 'Bearer my-ia-token')
  t.is(res.statusCode, 403)
})

test.serial("channelActions can't log into NewsBlur", async t => {
  await addUser()
  expectVerifyToken(200)
  expectApi('/reader/feeds', {authenticated: false})

  const res = await supertest(app).get('/newsblur/snarfed?action=channels')
      .set('Authorization', 'Bearer my-ia-token')
  t.is(res.statusCode, 401)
})

test.serial('channelActions', async t => {
  await addUser()
  expectVerifyToken(200)
  expectApi('/reader/feeds', nbFeeds)

  const res = await supertest(app).get('/newsblur/snarfed?action=channels')
      .set('Authorization', 'Bearer my-ia-token')
  t.is(res.statusCode, 200)
  t.deepEqual(res.body, msChannels)
})

test.serial('timelineAction', async t => {
  await addUser()
  expectVerifyToken(200)
  expectApi('/reader/feeds', nbFeeds)
  expectApi('/reader/river_stories?feeds=123&feeds=456&feeds=789', nbStories)

  const res = await supertest(app).get('/newsblur/snarfed?action=timeline')
      .set('Authorization', 'Bearer my-ia-token')
  t.is(res.statusCode, 200)
  t.deepEqual(res.body, msTimeline)
})

test.serial('timelineAction with channel', async t => {
  await addUser()
  expectVerifyToken(200)
  expectApi('/reader/feeds', nbFeeds)
  expectApi('/reader/river_stories?feeds=789', nbStories)

  const res = await supertest(app).get('/newsblur/snarfed?action=timeline&channel=Two')
      .set('Authorization', 'Bearer my-ia-token')
  t.is(res.statusCode, 200)
  t.deepEqual(res.body, msTimeline)
})

async function testPaging(t, param) {
  await addUser()
  expectVerifyToken(200)
  expectApi('/reader/feeds', nbFeeds)
  expectApi('/reader/river_stories?feeds=123&feeds=456&feeds=789&page=3', nbStories)

  const res = await supertest(app).get(`/newsblur/snarfed?action=timeline&${param}=3`)
      .set('Authorization', 'Bearer my-ia-token')
  t.is(res.statusCode, 200)

  let page3 = JSON.parse(JSON.stringify(msTimeline))  // deep copy
  page3['paging'] = {
    'before': '2',
    'after': '4',
  }
  t.deepEqual(res.body, page3)
}

test.serial('timelineAction with after', async t => { await testPaging(t, 'after') })
test.serial('timelineAction with before', async t => { await testPaging(t, 'before') })
