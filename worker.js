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
          // "url": "",
          // "photo": "",
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

/**
 * Fetch and log a given request object
 * @param {Request} request
 */
async function handleRequest(request) {
  console.log('Got request', request)
  const auth = request.headers.get('Authorization')
  if (!auth)
    return new Response('Missing Authorization header', {'status': 400});

  parts = auth.split(' ')
  if (!parts || parts.length != 2)
    return new Response('Bad Authorization header', {'status': 400});

  token = parts[1]
  if (!token)
    return new Response('Bad Authorization header', {'status': 400});

  const stories_resp = await fetch('https://newsblur.com/reader/river_stories', {
      method: 'GET',
      headers: {
        'Cookie': 'newsblur_sessionid=' + token,
        'User-Agent': 'baffle 1.0 (https://github.com/snarfed/baffle)',
        }
    })
  if (stories_resp.status != 200)
    return new Response('NewsBlur error: ' + stories_resp.statusText, {'status': stories_resp.status});
  const stories = await stories_resp.json()
  if (!stories['authenticated'])
    return new Response("Couldn't log into NewsBlur", {'status': 401});

  const resp = {
    "items": stories['stories'].map(storyToItem),
    // "paging": {
    //   "after": "xxx",
    //   "before": "yyy"
    // }
  }
  console.log(resp)
  return new Response(JSON.stringify(resp, null, 2),
                      {headers: {'Content-Type': 'application/json'}});
}
