/* Baffle CloudFlare worker.
 *
 * https://developers.cloudflare.com/workers/recipes/aggregating-multiple-requests/
 */
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function fetchItems(channel, token) {
  resp = await fetchNewsBlur('/reader/feeds', token)
  var feed_ids = null
  for (folder in resp['folders']) {
    if (folder instanceof Object &&
        (!channel || channel == Object.keys(folder)[0])) {
      feed_ids = Object.values(folder)[0]
      break
    }
  }

  params = new URLSearchParams()
  for (id in feed_ids)
    params.append('feeds', id)
  resp = await fetchNewsBlur('/reader/river_stories?' + params.toString(), token)
  if (resp instanceof Response)
    return resp

  return {'items': resp['stories'].map(
    function(s) { return {
      "type": "entry",
      "published": s['story_date'],
      "url": s['story_permalink'],
      "author": {
          "type": "card",
          "name": s['story_authors']
      },
      "category": s['story_tags'],
      // "photo": s['image_urls'],
      "name": s['story_title'],
      "content": {
          "html": s['story_content']
      },
      "_id": s['story_id'],
      "_is_read": s['read_status'] != 0
    }})
  }
}

async function fetchChannels(token) {
  resp = await fetchNewsBlur('/reader/feeds', token)
  if (resp instanceof Response)
    return resp

  folders = resp['folders']
  folders.push({'notifications': null})
  return {'channels':
    folders.filter(f => typeof f == 'object')
      .map(function(f) {
        name = Object.keys(f)[0]
        return {
          'uid': name,
          'name': name,
          'unread': 0
        }
      })
  }
}

async function fetchNewsBlur(path, token) {
  const nb_resp = await fetch('https://newsblur.com/' + path, {
      method: 'GET',
      headers: {
        'Cookie': 'newsblur_sessionid=' + token,
        'User-Agent': 'baffle 1.0 (https://github.com/snarfed/baffle)',
        }
    })
  if (nb_resp.status != 200)
    return new Response('NewsBlur error: ' + nb_resp.statusText, {'status': nb_resp.status})
  const nb_json = await nb_resp.json()
  if (!nb_json['authenticated'])
    return new Response("Couldn't log into NewsBlur", {'status': 401})
  // console.log('NewsBlur response: ' + JSON.stringify(nb_json))
  return nb_json
}

/**
 * Fetch and log a given request object
 * @param {Request} request
 */
async function handleRequest(request) {
  console.log('Got request', request)
  const auth = request.headers.get('Authorization')
  if (!auth)
    return new Response('Missing Authorization header', {'status': 400})

  parts = auth.split(' ')
  if (!parts || parts.length != 2)
    return new Response('Bad Authorization header', {'status': 400})

  token = parts[1]
  if (!token)
    return new Response('Bad Authorization header', {'status': 400})

  params = new URL(request.url).searchParams
  action = params.get('action')

  if (action == 'channels')
    resp = await fetchChannels(token)
  else if (action == 'timeline')
    resp = await fetchItems(params.get('channel'), token)
  else
    return new Response(action + ' action not supported yet', {'status': 501})

  console.log(resp)
  if (resp instanceof Response)
    return resp

  return new Response(JSON.stringify(resp, null, 2),
                      {headers: {'Content-Type': 'application/json'}})
}
