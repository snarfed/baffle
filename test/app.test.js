'use strict';

const test = require(`ava`);
const path = require(`path`);
const utils = require(`@google-cloud/nodejs-repo-tools`);

const cwd = path.join(__dirname, `../`);
const requestObj = utils.getRequest({ cwd: cwd });

test.serial.cb(`GET home page`, (t) => {
  requestObj
    .get(`/`)
    .expect(200)
    .expect((response) => {
      t.is(response.text, `Hello, world!`);
    })
    .end(t.end);
});
