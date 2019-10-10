const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/user');

const multer = require('multer');
const path = require('path');
//const DIR = 'Users/janblonde/angularauth/server/downloads/';
const DIR = './downloads';

// const mongoose = require('mongoose');
// const db = "mongodb://userjb:pwjb12@ds125342.mlab.com:25342/adb"
//
// mongoose.connect(db, err => {
//   if(err){
//     console.error('Error' + err)
//   } else {
//     console.log('Connected to mongodb')
//   }
// })

const Pool = require('pg').Pool
const pool = new Pool({
  user: 'me',
  host: 'localhost',
  database: 'api',
  password: 'ciFE',
  port: 5432,
})

function verifyToken(req, res, next){
  if(!req.headers.authorization){
    console.log('Unauthorized request');
    return res.status(401).send('Unauthorized request')
  }

  let token = req.headers.authorization.split(' ')[1]
  if(token === 'null'){
    console.log('Unauthorized request')
    return res.status(401).send('Unauthorized request')
  }

  jwt.verify(token, 'secretKey', function(err, decoded){
    if (err) {
      console.log('Unauthorized request')
      return res.status(401).send('Unauthorized request')
    } else {
      //console.log(decoded);
      req.userId = decoded.subject;
      next();
          // if everything is good, save to request for use in other routes
          //req.decoded = decoded;
          //next();
    }
  })
  // if(!payload) {
  //   return res.status(401).send('Unauthorized request')
  // }
  //
  // req.userId = payload.subject
  // next()
}

router.get('/', (req,res) => {
  res.send('From API route');
})

router.post('/register', (req, res) =>{
  let userData = req.body
  let user = new User(userData);

  // user.save((error, registeredUser)=>{
  //   if(error){
  //     console.log(error)
  //   }else{
  //     let payload = {subject:registeredUser._id}
  //     let token = jwt.sign(payload, 'secretKey')
  //     res.status(200).send({token})
  //   }
  // })

  //TODO check for duplicate email

  pool.query('INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id', [user.email, user.password], (error, results) => {
    if (error) {
      throw error
    }
    let payload = {subject:results.rows[0].id};
    let token = jwt.sign(payload, 'secretKey');
    res.status(200).send({token});
  })
})

router.post('/login', (req, res) => {
  let userData = req.body

  // User.findOne({email: userData.email}, (error, user) =>{
  //   if(error){
  //     console.log(error)
  //   }else{
  //     if(!user){
  //       res.status(401).send('Invalid email')
  //     }else{
  //       if(user.password !== userData.password){
  //         res.status(401).send('Invalid password')
  //       }else{
  //         let payload = {subject:user._id}
  //         let token = jwt.sign(payload, 'secretKey')
  //         res.status(200).send({token})
  //       }
  //     }
  //   }
  // })

  pool.query('SELECT * FROM users WHERE email = $1', [userData.email], (error, results) => {
    if (error) {
      console.log(error)
    }else{
      if(!results.rows[0]){
        res.status(401).send('Invalid email')
      }else{
        if(results.rows[0].password !== userData.password){
          res.status(401).send('Invalid password')
        }else{
          let payload = {subject:results.rows[0].id}
          let token = jwt.sign(payload, 'secretKey')
          res.status(200).send({token})
        }
      }
    }
  })
})

router.post('/units', verifyToken, (req,res) => {
  console.log('post units');

  pool.query('INSERT INTO units (naam, duizendste, fk_users) VALUES ($1, $2, $3) RETURNING id',
                [req.body.naam, req.body.duizendste, req.userId], (error, results) => {
                  if(error) {
                    console.log('error');
                  }else{
                    console.log(results);
                    res.status(200).send(results);
                  }
                })
})

router.put('/units', verifyToken, (req,res) => {
  console.log('put units');

  pool.query("UPDATE units SET naam=$1, duizendste=$2 WHERE id=$3 RETURNING id",
                [req.body.naam, req.body.duizendste, req.body.id], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send(results);
                  }
                })
})

router.get('/units', verifyToken, (req, res) =>{
  console.log('get units');

  let queryString = "SELECT units.id as id, units.naam as naam, units.duizendste as duizendste,"+
                    "partners.naam as eigenaar, partners.id as eigenaarid from units " +
                    "LEFT OUTER JOIN eigendom ON units.id = eigendom.unit " +
                    "LEFT OUTER JOIN partners ON eigendom.eigenaar = partners.id " +
                    "WHERE units.fk_users = $1"

  //'SELECT id,naam, duizendste from units WHERE fk_users = $1'

  pool.query(queryString, [req.userId], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      console.log(results.rows);
      res.status(200).send(results.rows);
    }
  })

});

router.get('/unit', verifyToken, (req, res) =>{
  console.log('get unit');
  // console.log(req.params.id);
  console.log(req.query.id);

  pool.query('SELECT id, naam, duizendste from units WHERE id = $1', [req.query.id], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      console.log(results.rows[0])
      res.status(200).send(results.rows[0]);
    }
  })

});

router.post('/eigenaars', verifyToken, (req, res) => {
  pool.query("INSERT INTO partners (naam, voornaam, bankRNR, email, type) VALUES ($1, $2, $3, $4, 'eigenaar') RETURNING id",
                [req.body.naam, req.body.voornaam, req.email, req.body.email], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    console.log(results);
                    createEigendom(req, res, results.rows[0].id, req.body.unitFK);
                    //res.status(200).send(results);
                  }
                })
})

function createEigendom(req, res, eigenaarId, unitId) {

  pool.query('INSERT INTO eigendom (eigenaar, unit) VALUES ($1, $2) RETURNING id',
                [eigenaarId, unitId], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send(results);
                  }
                })

}

router.put('/eigenaars', verifyToken, (req,res) => {
  console.log('put eigenaars');
  console.log(req.body);

  pool.query("UPDATE partners SET naam=$1, voornaam=$2, email=$3, bankRNR=$4 WHERE id=$5 RETURNING id",
                [req.body.naam, req.body.voornaam, req.body.email, req.body.bankrnr, req.body.id], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send(results);
                  }
                })
})

router.get('/eigenaar', verifyToken, (req, res) =>{
  console.log('get unit');
  // console.log(req.params.id);
  console.log(req.query.id);

  pool.query('SELECT id, naam, voornaam, email, bankrnr from partners WHERE id = $1', [req.query.id], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      console.log(results.rows[0])
      res.status(200).send(results.rows[0]);
    }
  })

});

router.get('/events', (req, res) => {
  let events = [
    {
      "_id": "1",
      "name": "Auto Expo",
      "description": "lorem ipsum",
      "date": "2012-04-23T18:25:43.511Z"
    },
    {
      "_id": "2",
      "name": "Auto Expo",
      "description": "lorem ipsum",
      "date": "2012-04-23T18:25:43.511Z"
    },
    {
      "_id": "3",
      "name": "Auto Expo",
      "description": "lorem ipsum",
      "date": "2012-04-23T18:25:43.511Z"
    },
    {
      "_id": "4",
      "name": "Auto Expo",
      "description": "lorem ipsum",
      "date": "2012-04-23T18:25:43.511Z"
    },
    {
      "_id": "5",
      "name": "Auto Expo",
      "description": "lorem ipsum",
      "date": "2012-04-23T18:25:43.511Z"
    },
    {
      "_id": "6",
      "name": "Auto Expo",
      "description": "lorem ipsum",
      "date": "2012-04-23T18:25:43.511Z"
    }
  ]
  res.json(events)
})

router.get('/special', verifyToken, (req, res) => {
  let specialEvents = [
    {
      "_id": "1",
      "name": "Auto Expo Special",
      "description": "lorem ipsum",
      "date": "2012-04-23T18:25:43.511Z"
    },
    {
      "_id": "2",
      "name": "Auto Expo Special",
      "description": "lorem ipsum",
      "date": "2012-04-23T18:25:43.511Z"
    },
    {
      "_id": "3",
      "name": "Auto Expo Special",
      "description": "lorem ipsum",
      "date": "2012-04-23T18:25:43.511Z"
    },
    {
      "_id": "4",
      "name": "Auto Expo Special",
      "description": "lorem ipsum",
      "date": "2012-04-23T18:25:43.511Z"
    },
    {
      "_id": "5",
      "name": "Auto Expo Special",
      "description": "lorem ipsum",
      "date": "2012-04-23T18:25:43.511Z"
    },
    {
      "_id": "6",
      "name": "Auto Expo Special",
      "description": "lorem ipsum",
      "date": "2012-04-23T18:25:43.511Z"
    }
  ]
  res.json(specialEvents)
})

let storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, DIR);
    },
    filename: (req, file, cb) => {
      cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

let upload = multer({storage: storage});

router.post('/upload',upload.single('photo'), function (req, res) {
    if (!req.file) {
        console.log("No file received");
        return res.send({
          success: false
        });

      } else {
        console.log('file received');
        return res.send({
          success: true
        })
      }
});

module.exports = router;
