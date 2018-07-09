'use strict'

const express = require('express')
const newsblur = require('./newsblur.js')

const app = express()

app.get('/', (req, res) => {
  res.status(200).send('Hello, world!').end()
})

app.get('/newsblur/:userId', async (req, res) => {
  await newsblur.handle(req, res)
  // console.log('Outside, sending response', res.statusCode)
  // res.end()
})

module.exports = app
