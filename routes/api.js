const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/user');

const multer = require('multer');
const path = require('path');
//const csv = require('csvtojson');
const csv = require('fast-csv');
const fs = require('fs');
//const DIR = 'Users/janblonde/angularauth/server/downloads/';
const DIR = './downloads';

var each = require('async-each');

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
// const pool = new Pool({
//   user: 'me',
//   host: 'localhost',
//   database: 'api',
//   password: 'ciFE',
//   port: 5432,
// })

const pool = new Pool({
  user: 'postgres',
  host: 'ec2-35-156-15-195.eu-central-1.compute.amazonaws.com',
  database: 'api',
  password: 'coPRbi51',
  port: 5432,
})

function verifyToken(req, res, next){
  if(!req.headers.authorization){
    console.log('Unauthorized request 1');
    return res.status(401).send('Unauthorized request')
  }

  let token = req.headers.authorization.split(' ')[1]
  if(token === 'null'){
    console.log('Unauthorized request 2')
    return res.status(401).send('Unauthorized request')
  }

  jwt.verify(token, 'secretKey', function(err, decoded){
    if (err) {
      console.log('Unauthorized request 3')
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
  //console.log(req.headers);

  let queryString = "SELECT units.id as id, units.naam as naam, units.duizendste as duizendste,"+
                    "partners.naam as eigenaar, partners.id as eigenaarid from units " +
                    "LEFT OUTER JOIN eigendom ON units.id = eigendom.unit " +
                    "LEFT OUTER JOIN partners ON eigendom.eigenaar = partners.id " +
                    "WHERE units.fk_users = $1 ORDER BY units.naam";

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
  console.log(req.body);
  pool.query("INSERT INTO partners (naam, voornaam, bankrnr, email, fk_type, fk_users) VALUES ($1, $2, $3, $4, 1, $5) RETURNING id",
                [req.body.naam, req.body.voornaam, req.body.bankrnr, req.body.email, req.userId], (error, results) => {
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

  pool.query("UPDATE partners SET naam=$1, voornaam=$2, email=$3, bankrnr=$4 WHERE id=$5 RETURNING id",
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

router.get('/uittreksels', verifyToken, (req,res)=>{
  console.log('get uittreksels');

  let queryString = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN bankrekeningen as br ON bu.fk_bankrekening = br.id " +
                    "WHERE br.fk_users = ($1) AND br.type = 'werk';"

  pool.query(queryString, [req.userId], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      console.log(results.rows);
      res.status(200).send(results.rows);
    }
  })
})

router.get('/uittreksel', verifyToken, (req,res)=>{
  console.log('get uittreksel');
  console.log(req.query.id);

  let queryString = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, bu.omschrijving FROM bankrekeninguittreksels as bu " +
                    "WHERE bu.id = ($1);"

  pool.query(queryString, [req.query.id], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      console.log(results.rows);
      res.status(200).send(results.rows);
    }
  })
})

router.get('/ongekoppelde_uittreksels', verifyToken, (req,res)=>{
  console.log('get ongekoppelde uittreksels');

  let queryString = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, bu.omschrijving " +
                    "FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN bankrekeningen as br ON bu.fk_bankrekening = br.id " +
                    "WHERE br.fk_users = ($1) AND br.type = 'werk' AND bu.fk_partner is Null;"

  pool.query(queryString, [req.userId], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      console.log(results.rows);
      res.status(200).send(results.rows);
    }
  })
})

router.post('/partners', verifyToken, (req, res) => {
  pool.query("INSERT INTO partners (naam, bankrnr, fk_type, fk_users) VALUES ($1, $2, $3, $4) RETURNING id",
                [req.body.naam, req.body.rekeningnummer, req.body.fk_type, req.userId], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    console.log(results);
                    res.status(200).send(results);
                  }
                })
})

router.put('/uittreksels', verifyToken, (req,res) => {
  console.log('put uittreksels');
  console.log(req.body);


  pool.query("UPDATE bankrekeninguittreksels SET fk_partner=$1 WHERE tegenrekening=$2",
                [req.body.id, req.body.rekeningnummer], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send(results);
                  }
                })

})

router.get('/kostentypes', verifyToken, (req,res) => {
  console.log('kostentypes');
  pool.query("SELECT id, naam from kosten_types WHERE fk_users = $1 and id>1",
              [req.userId], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results);
                }
              })
})



//fileupload
let storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, DIR);
    },
    filename: (req, file, cb) => {
      cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

//let upload = multer({storage: storage});
const upload = multer({ dest: 'uploads/' });

router.post('/upload', upload.single('photo'), verifyToken, async function (req, res) {
    console.log('entry');
    if (!req.file) {
      console.log("No file received");
      return res.send({
        success: false
      });
    }

    //get rekeningnummers
    const result = await pool.query('SELECT id, rekeningnummer FROM bankrekeningen WHERE fk_users = ($1)', [req.userId]);

    rekeningnummers = new Map();
    if(result.rows){
      result.rows.forEach((element)=>{
        rekeningnummers.set(element.rekeningnummer,element.id);
      })
    }

    //get partners: fk's en types
    const p_result = await pool.query('SELECT id, fk_type, bankrnr FROM partners WHERE fk_users = ($1)', [req.userId]);

    p_rekeningnummers = new Map();
    if(p_result.rows){
      p_result.rows.forEach((element)=>{
        p_rekeningnummers.set(element.bankrnr,element.id);
      })
    }

    p_types = new Map();
    if(p_result.rows){
      p_result.rows.forEach((element)=>{
        p_types.set(element.bankrnr,element.fk_type);
      })
    }

    const fileRows = []
    csv.parseFile(req.file.path, {delimiter:';'})
      .on("data", async function (data) {
        fileRows.push(data);
      })
      .on("end", async function () {
        for(const data of fileRows){

          if(rekeningnummers.has(data[0])){

            date= data[5].substr(6,4)+'/'+data[5].substr(3,2)+'/'+data[5].substr(0,2);

            let queryString = 'INSERT INTO bankrekeninguittreksels (datum, bedrag, omschrijving, tegenrekening, fk_bankrekening, fk_partner, fk_type) '+
                              'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id';
            const results = await pool.query(queryString,[date,
                                                          data[8].replace(",","."),
                                                          data[6].substr(0,299),
                                                          data[12],
                                                          rekeningnummers.get(data[0]),
                                                          p_rekeningnummers.get(data[12]),
                                                          p_types.get(data[12])])//,
          }
        }
        fs.unlinkSync(req.file.path);
        return res.sendStatus(200);
      });

});

module.exports = router;
