/* CloudFlare worker.
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
  const stories_resp = await fetch('https://newsblur.com/reader/river_stories', {
      method: 'GET',
      headers: {
        'Cookie': 'newsblur_sessionid=REDACTED',
        'User-Agent': 'baffle 1.0 (https://github.com/snarfed/baffle)',
        }
    })
  const stories = await stories_resp.json()
  const resp = {
    "items": stories['stories'].map(storyToItem),
    "paging": {
      "after": "xxx",
      "before": "yyy"
    }
  }
  console.log(resp)
  return new Response(JSON.stringify(resp),
                      {headers: {'Content-Type': 'application/json'}});
}
