'use strict'

const test = require('ava')
const express = require('express')
const nock = require('nock')
const fetch = require('node-fetch')
const supertest = require('supertest')

const app = require('../app.js')


test('fetchChannels', async t => {
  nock('https://newsblur.com')
       // {reqheaders: {Cookie: 'newsblur_sessionid=abc123', 'User-Agent': 'Baffle (https://baffle.tech)'}})
    .get('/reader/feeds')
    .reply(200, {
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
    })

  const res = await supertest(app).get('/newsblur/1?action=channels')
      .set('Authorization', 'Bearer my-token')
  t.is(res.statusCode, 200)
  t.deepEqual(res.body, {
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
  })
})

// test('fetchItems', async t => {
//   nock('https://newsblur.com')
//        // {reqheaders: {Authentication: 'Bearer abc123'}})
//        // {reqheaders: {Cookie: 'newsblur_sessionid=abc123'}})
//     .get('/reader/river_stories')
//     .reply(200, {
//       story_id: 'abc987',
//       story_permalink: 'http://example.com/post',
//       story_date: '2017-01-01 00:00:00',
//       story_title: 'My post',
//       story_content: 'Writing some <em>HTML</em>.',
//       read_status: 0,
//       story_tags: ['one', 'two'],
//       story_authors: 'Ms. Foo',

//       image_urls: ['http://example.com/image.png'],
//       story_feed_id: 5917088,
//       story_hash: '5917088:47ea23',
//       guid_hash: '47ea23',
//     })

//   t.deepEqual({
//     type: 'entry',
//     _id: 'abc987',
//     _is_read: false,
//     url: 'http://example.com/post',
//     name: 'My post',
//     content: {'html': 'Writing some <em>HTML</em>.'},
//     published: '2017-01-01 00:00:00',
//     author: {
//       type: 'card',
//       name: 'Ms. Foo',
//     },
//     category: ['one', 'two'],
//   }, newsblur.fetchItems())
// })
