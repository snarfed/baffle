'use strict'

const app = require('./app.js')

// Start the server
const PORT = process.env.PORT || 8080
const server = app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`)
  console.log('Press Ctrl+C to quit.')
})

module.exports = server
