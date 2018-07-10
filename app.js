'use strict'

const express = require('express')
const newsblur = require('./newsblur.js')

const app = express()

app.get('/', (req, res) => {
  // console.log('Got request', req.url, req.body, req)
  res.status(200).send('Hello, world! ' + req)
})

app.get('/newsblur/start', (req, res) => {
  newsblur.oauthStart(req, res)
})

app.get('/newsblur/callback', async (req, res) => {
  await newsblur.oauthCallback(req, res)
})

app.get('/newsblur/:userId', async (req, res) => {
  await newsblur.handle(req, res)
  // console.log('Sending response', res.statusCode)
})

module.exports = app
