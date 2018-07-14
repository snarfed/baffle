/* NewsBlur endpoint.
 *
 * https://newsblur.com/api
 */
'use strict'

const assert = require('assert');
const Datastore = require('@google-cloud/datastore')
const fetch = require('node-fetch')
const { JSDOM } = require('jsdom')
const querystring = require('querystring')
const { URL, URLSearchParams } = require('url')

// TODO: override in unit tests
const secrets = require('../secrets.json')

// set up app engine datastore connection.
// (ideally we'd use app.get('env') but app isn't available here.)
let datastore = new Datastore(
  (process.env.NODE_ENV == 'production'
   ? {}
   : {apiEndpoint: 'http://localhost:8081'}))
module.exports.datastore = datastore


function err(res, status, msg) {
  console.log(`${status} ${msg}`)
  res.status(status).send(msg)
}

/**
 * Top level URL handler for Microsub actions.
 * @param {Request} req
 */
async function handle(req, res) {
  // console.log('Got request', req.url, req.body)
  const auth = req.header('Authorization')
  if (!auth)
    return err(res, 401, 'Missing Authorization header')

  const parts = auth.split(' ')
  if (!parts || parts.length != 2 || parts[0] != 'Bearer' || !parts[1])
    return err(res, 400, 'Bad Authorization header: ' + auth)

  const users = await datastore.get(
    [datastore.key(['NewsBlurUser', req.params.username])])
  if (users.length == 0 || users[0].length == 0)
    return err(res, 400, 'User ' + req.params.username +
               ' not found. Try signing up on https://baffle.tech !')

  const user = users[0][0]
  assert(user.token_endpoint)
  const token = users[0][0].access_token
  assert(token)

  // Verify token
  // https://indieweb.org/token-endpoint#Verifying_an_Access_Token
  const verifyRes = await fetch(user.token_endpoint, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'User-Agent': 'Baffle (https://baffle.tech)',
    }})
  if (!verifyRes.ok)
    return err(res, 403, `Couldn't verify acces token with ${user.token_endpoint}: ${verifyRes.status} ${verifyRes.statusText}`)

  // Route to specific action handler
  if (req.query.action == 'channels')
    await fetchChannels(res, token)
  else if (req.query.action == 'timeline')
    await fetchItems(res, req.query.channel, token)
  else
    err(res, 501, req.query.action + ' action not supported yet')

  // console.log('Inside, sending response', res.statusCode)
}
module.exports.handle = handle

/**
 * OAuth.
 */
function oauthRedirectUri(req) {
  return new URL('/newsblur/callback',
                 req.protocol + '://' + req.header('Host')
                 // for testing live, until localhost:8080 is whitelisted
                 // 'https://baffle.tech'
                ).toString()
}

function oauthStart(req, res) {
  const url = 'https://newsblur.com/oauth/authorize?' + querystring.stringify({
    response_type: 'code',
    redirect_uri: oauthRedirectUri(req),
    client_id: secrets.newsblur.client_id,
  })
  console.log('Redirecting to ', url)
  res.redirect(url)
}
module.exports.oauthStart = oauthStart

async function oauthCallback(req, res) {
  // Exchange auth code for access token
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: req.query.code,
    redirect_uri: oauthRedirectUri(req),
    client_id: secrets.newsblur.client_id,
    client_secret: secrets.newsblur.client_secret,
  })
  const tokenRes = await fetch('https://newsblur.com/oauth/token', {
      method: 'POST',
      headers: {'User-Agent': 'Baffle (https://baffle.tech)'},
      body: body,
  })

  if (!tokenRes.ok)
    return err(res, tokenRes.status, 'NewsBlur error: ' + tokenRes.statusText)

  // Get user profile
  const token = (await tokenRes.json()).access_token
  const profile = await fetchNewsBlur(res, '/social/profile', token)
  if (!profile || !profile.user_profile)
    return

  const website = profile.user_profile.website
  if (!website)
    return res.status(400).render('index', {
      error: 'Please add your web site to your NewsBlur profile, then try again!'})

  // Discover token endpoint
  const websiteRes = await fetch(website, {
      method: 'GET',
      headers: {'User-Agent': 'Baffle (https://baffle.tech)'},
  })
  if (!websiteRes.ok)
    return err(res, 400, `Couldn't fetch your web site ${website}: ${websiteRes.status} ${websiteRes.statusText}`)


  let endpoint = null
  const links = websiteRes.headers.get('Link')
  if (links) {
    for (let link of links.split(',')) {
      const match = / *<(.+)>; rel=['"]token_endpoint['"] */.exec(link)
      if (match) {
        endpoint = match[1]
        break
      }
    }
  }

  if (!endpoint) {
    let dom = new JSDOM(await websiteRes.text())
    let link = dom.window.document.querySelector('link[rel="token_endpoint"]')
    if (link)
      endpoint = link.href
  }

  if (!endpoint)
    return err(res, 400, `Couldn't find a token endpoint in your web site ${website}`)

  // Store user in datastore
  await datastore.save({
    key: datastore.key(['NewsBlurUser', profile.user_profile.username]),
    data: {
      access_token: token,
      token_endpoint: endpoint,
      profile: profile,
    },
  })
  res.render('index', {username: profile.user_profile.username})
}
module.exports.oauthCallback = oauthCallback


/**
 * Microsub.
 */
async function fetchItems(res, channel, token) {
  const feeds = await fetchNewsBlur(res, '/reader/feeds', token)
  // TODO: switch to exceptions
  if (!feeds)
    return

  let feedIds = null
  for (const folder in feeds.folders) {
    if (folder instanceof Object &&
        (!channel || channel == Object.keys(folder)[0])) {
      feedIds = Object.values(folder)[0]
      break
    }
  }

  let params = new URLSearchParams()
  for (id in feedIds)
    params.append('feeds', id)
  const stories = await fetchNewsBlur(
    res, '/reader/river_stories?' + params.toString(), token)
  if (!stories)
    return

  res.json({'items': stories.stories.map(s => ({
    type: 'entry',
    published: s.story_date,
    url: s.story_permalink,
    author: {
      type: 'card',
      name: s.story_authors,
    },
    category: s.story_tags,
    // photo: s.image_urls,
    name: s.story_title,
    content: {html: s.story_content},
    _id: s.story_id,
    _is_read: s.read_status != 0,
  }))})
}

async function fetchChannels(res, token) {
  let feeds = await fetchNewsBlur(res, '/reader/feeds', token)
  if (!feeds)
    return feeds

  feeds.folders.push({'notifications': null})
  res.json({
    'channels': feeds.folders.filter(f => typeof f == 'object')
      .map(f => {
        const name = Object.keys(f)[0]
        return {
          'uid': name,
          'name': name,
          'unread': 0
        }
      })
  })
}

/**
 * Makes a NewsBlur API call.
 *
 * If it succeeds, returns a JSON object. If it fails, writes details into res
 * and returns null.
 *
 * @param {String} path, NewsBlur API path
 * @param {String} token, access token
 * @param {express.Response} res
 */
async function fetchNewsBlur(res, path, token) {
  const nbRes = await fetch('https://newsblur.com' + path, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'User-Agent': 'Baffle (https://baffle.tech)',
      }
    })
  if (!nbRes.ok)
    return err(res, nbRes.status, 'NewsBlur error: ' + nbRes.statusText)

  const nbJson = await nbRes.json()
  if (!nbJson.authenticated)
    return err(res, 401, "Couldn't log into NewsBlur" + JSON.stringify(nbJson))

  return nbJson
}
