/* NewsBlur endpoint.
 *
 * https://newsblur.com/api
 */
'use strict'

const Datastore = require('@google-cloud/datastore')
const fetch = require('node-fetch')
const querystring = require('querystring')
const { URL, URLSearchParams } = require('url')

// TODO: override in unit tests
const secrets = require('./secrets.json')

// non-const so that unit tests can override
let datastore = new Datastore()
// {
//   apiEndpoint: 'http://localhost:8081',
// })
module.exports.datastore = datastore


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

  if (tokenRes.status != 200) {
    const msg = 'NewsBlur error: ' + tokenRes.statusText
    console.log(msg)
    res.status(tokenRes.status).send(msg)
    return
  }

  // Get user profile, store in datastore
  const token = (await tokenRes.json()).access_token
  const profile = await fetchNewsBlur(res, '/social/profile', token)
  if (!profile)
    return

  await datastore.save({
    key: datastore.key(['NewsBlurUser', profile.user_profile.username]),
    data: {
      access_token: token,
      profile: profile,
    },
  })
  res.send('ok!')
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
  for (folder in feeds['folders']) {
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

  res.json({'items': stories['stories'].map(
    function(s) { return {
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
    }})
  })
}

async function fetchChannels(res, token) {
  let feeds = await fetchNewsBlur(res, '/reader/feeds', token)
  if (!feeds)
    return feeds

  feeds.folders.push({'notifications': null})
  const channels = {
    'channels': feeds.folders.filter(f => typeof f == 'object')
      .map(function(f) {
        const name = Object.keys(f)[0]
        return {
          'uid': name,
          'name': name,
          'unread': 0
        }
      })
  }
  res.json(channels)
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
  if (nbRes.status != 200) {
    const msg = 'NewsBlur error: ' + nbRes.statusText
    console.log(msg)
    res.status(nbRes.status).send(msg)
    return
  }

  const nbJson = await nbRes.json()
  if (!nbJson['authenticated']) {
    const msg = "Couldn't log into NewsBlur" + JSON.stringify(nbJson)
    console.log(msg)
    res.status(401).send(msg)
    return
  }

  return nbJson
}

/**
 * Fetch and log a given request object
 * @param {Request} req
 */
async function handle(req, res) {
  // console.log('Got request', req.url, req.body)
  const auth = req.header('Authorization')
  if (!auth)
    return res.status(400).send('Missing Authorization header')

  const parts = auth.split(' ')
  if (!parts || parts.length != 2)
    return res.status(400).send('Bad Authorization header')

  const token = parts[1]
  if (!token)
    return res.status(400).send('Bad Authorization header')

  if (req.query.action == 'channels')
    await fetchChannels(res, token)
  else if (req.query.action == 'timeline')
    await fetchItems(params.get('channel'), res, token)
  else
    res.status(501).send(req.query.action + ' action not supported yet')

  // console.log('Inside, sending response', res.statusCode)
}
module.exports.handle = handle
