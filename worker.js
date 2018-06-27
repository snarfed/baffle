/* Baffle CloudFlare worker.
 *
 * https://developers.cloudflare.com/workers/recipes/aggregating-multiple-requests/
 */
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

function storyToItem(s) {
  return {
      "type": "entry",
      "published": s['story_date'],
      "url": s['story_permalink'],
      "author": {
          "type": "card",
          "name": s['story_authors']
      },
      "category": s['story_tags'],
      "photo": s['image_urls'],
      "name": s['story_title'],
      "content": {
          "html": s['story_content']
      },
      "_id": s['story_id'],
      "_is_read": s['read_status'] != 0
  }
}

function foldersToChannels(folders) {
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

  const nb_init = {
      method: 'GET',
      headers: {
        'Cookie': 'newsblur_sessionid=' + token,
        'User-Agent': 'baffle 1.0 (https://github.com/snarfed/baffle)',
        }
    }

  if (action == 'timeline')
    nb_path = 'reader/river_stories'
  else if (action == 'channels')
    nb_path = 'reader/feeds'
  else
    return new Response(action + ' action not supported yet', {'status': 501})

  const nb_resp = await fetch('https://newsblur.com/' + nb_path, nb_init)
  if (nb_resp.status != 200)
    return new Response('NewsBlur error: ' + nb_resp.statusText, {'status': nb_resp.status});
  const nb_json = await nb_resp.json()
  if (!nb_json['authenticated'])
    return new Response("Couldn't log into NewsBlur", {'status': 401})
  // console.log('NewsBlur response: ' + JSON.stringify(nb_json))

  if (action == 'channels')
    resp = foldersToChannels(nb_json['folders'])
  else if (action == 'timeline')
    resp = {'items': nb_json['stories'].map(storyToItem)}
  else
    return new Response(action + ' action not supported yet', {'status': 501})

  console.log(resp)
  return new Response(JSON.stringify(resp, null, 2),
                      {headers: {'Content-Type': 'application/json'}});
}

