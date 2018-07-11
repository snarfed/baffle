'use strict'

const express = require('express')
const newsblur = require('./newsblur.js')

const app = express()
app.enable('trust proxy')

/*
 * Catch exceptions in async functions that would otherwise hang supertest.
 *
 * (I'm sure there's a better way to do this, and I'm just using supertest or
 * express or ava wrong somehow, but I couldn't figure out how. :P)
 */
function catcher(fn) {
  return async function(req, res) {
    try {
      await fn(req, res)
    } catch (err) {
      console.error('ooo', err)
      res.end()
    }
  }
}

app.get('/newsblur/start', (req, res) => {
  newsblur.oauthStart(req, res)
})

app.get('/newsblur/callback', catcher(async (req, res) => {
  await newsblur.oauthCallback(req, res)
}))

app.get('/newsblur/:userId', catcher(async (req, res) => {
  await newsblur.handle(req, res)
}))

module.exports = app
