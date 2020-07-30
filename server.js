const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const https = require('https');

const PORT = 3000;
const api = require('./routes/api')
const app = express()
app.use(cors())

app.use(bodyParser.json());

app.use('/api', api);

app.get('/',function(req,res){
  res.send('Hello from server')
})

https.createServer({
  key: fs.readFileSync('/etc/ssl/private/www_sndx_be.key'),
  cert: fs.readFileSync('/etc/ssl/certs/www_sndx_be.crt')
}, app)
.listen(PORT, function () {
  console.log('Server running')
})

// app.listen(PORT,function(){
//   console.log('Server running')
// })
