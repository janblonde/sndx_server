const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/user');

const multer = require('multer');
const path = require('path');
const csv = require('fast-csv');
const fs = require('fs');
const DIR = './downloads';
const nodemailer = require('nodemailer');

const config = require('../config.json');

var each = require('async-each');

//---DATABASE---

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
//   password: '',
//   port: ,
// })

const pool = new Pool({
  user: config.dbuser,
  host: config.dbhost,
  database: config.database,
  password: config.dbpassword,
  port: config.dbport,
})

//---EMAIL---

// const transporter = nodemailer.createTransport({
//   service: 'gmail',
//   auth: {
//     user: config.mailuser,
//     pass: config.mailpassword
//   }
// });
//
// const mailOptions = {
//   from: 'janhendrikblonde@gmail.com',
//   to: 'jan.blonde@icloud.com',
//   subject: 'Sending Email using Node.js',
//   text: 'That was easy!'
// };


const transporter = nodemailer.createTransport({
  host: 'smtp-auth.mailprotect.be',
  port: 465,
  auth: {
    user: config.mailuser,
    pass: config.mailpassword
  }
});

const mailOptions = {
  from: 'info@sndx.be',
  to: 'jan.blonde@icloud.com',
  subject: 'Sending Email using Node.js',
  text: 'That was easy!'
};

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

  jwt.verify(token, config.key, function(err, decoded){
    if (err) {
      console.log('Unauthorized request 3')
      return res.status(401).send('Unauthorized request')
    } else {
      req.gebouw = decoded.gebouw;
      req.userId = decoded.subject;
      next();
    }
  })
}

router.get('/', (req,res) => {
  res.send('From API route');
})

router.get('/mail',(req,res)=>{
  console.log(req.query)

  let options = {
    from:'',
    to:'',
    subject:'',
    text:''
  }

  if(req.query){
    options.from = req.query.email
    options.to = 'jan.blonde@icloud.com'
    options.subject = req.query.name
    options.text = req.query.message
  }

  console.log(options)
  transporter.sendMail(options, function(error,info){
    if(error){
      console.log(error);
    }else{
      console.log('Email sent: ' + info.response);
      res.status(200).send('OK');
    }
  })
})

router.post('/register', async function (req, res){
  let userData = req.body
  let user = new User(userData);
  console.log('register');
  console.log(req.body);

  let resultsExisting = await pool.query('SELECT * FROM users WHERE email = $1',[user.email])
  //console.log(resultsExisting.rows[0])

  if(resultsExisting.rows[0]){

    res.status(400).send({'message':'Een account met dit e-mail adres bestaat al'})

  }else{

    let resultsGebouwen = await pool.query('INSERT INTO gebouwen (overgenomen_werkrekening, overgenomen_reserverekening) VALUES (0, 0) RETURNING id')

    let results = await pool.query('INSERT INTO users (email, password, fk_gebouw) VALUES ($1, $2, $3) RETURNING id',
                                 [user.email, user.password, resultsGebouwen.rows[0].id]);

    await pool.query("INSERT INTO kosten_types (naam, verdeling, fk_gebouw) VALUES ($1,'',$2)", ['electriciteit',resultsGebouwen.rows[0].id]);
    await pool.query("INSERT INTO kosten_types (naam, verdeling, fk_gebouw) VALUES ($1,'', $2)", ['schoonmaak',resultsGebouwen.rows[0].id]);
    await pool.query("INSERT INTO kosten_types (naam, verdeling, fk_gebouw) VALUES ($1,'', $2)", ['verwarming',resultsGebouwen.rows[0].id]);
    await pool.query("INSERT INTO kosten_types (naam, verdeling, fk_gebouw) VALUES ($1,'', $2)", ['waterverbruik',resultsGebouwen.rows[0].id]);
    await pool.query("INSERT INTO kosten_types (naam, verdeling, fk_gebouw) VALUES ($1,'', $2)", ['herstelling en onderhoud',resultsGebouwen.rows[0].id]);
    await pool.query("INSERT INTO kosten_types (naam, verdeling, fk_gebouw) VALUES ($1,'', $2)", ['administratie',resultsGebouwen.rows[0].id]);

    let payload = {subject:results.rows[0].id, gebouw: resultsGebouwen.rows[0].id};

    let token = jwt.sign(payload, config.key);

    res.status(200).send({token});
  }
})

router.post('/login', (req, res) => {
  let userData = req.body

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
          let payload = {subject:results.rows[0].id, gebouw:results.rows[0].fk_gebouw}
          let token = jwt.sign(payload, 'secretKey')
          res.status(200).send({token})
        }
      }
    }
  })
})

router.get('/userbytoken', (req, res) => {

  if(!req.query.reset||req.query.reset==''){
    console.log('ERROR!!!')
  }else{
    pool.query('SELECT id FROM users where reset = $1',[req.query.reset], (error, results) => {
      if(error){
        console.log(error)
      }else{
        res.status(200).send(results)
      }
    })
  }
})

router.get('/resettoken', (req,res) => {

  let digits = '0123456789aBcdEfGHIj';
  let OTP = '';
  for (let i = 0; i < 12; i++ ) {
      OTP += digits[Math.floor(Math.random() * 20)];
  }

  pool.query('UPDATE users SET reset=$1 WHERE email=$2', [OTP, req.query.email], (error, results) =>{
    if(error){
       console.log(error)
    }else{

      if(results.rowCount==0){
        res.status(400).send({message:'geen account gevonden voor dit e-mail adres'})
      }else{

        //send mail
        let content={
          from:'info@sndx.be',
          to:req.query.email,
          subject:'Paswoord opnieuw instellen',
          text:'Beste, via volgende link kan je een nieuw paswoord ingeven: http://localhost:4200/passwordreset?code='+OTP,
        }

        transporter.sendMail(content, function(error,info){
          if(error){
            console.log(error);
          }else{
            console.log('Email sent: ' + info.response);
            res.status(200).send({message:'email verzonden'});
          }})
      }
    }
  })
})

router.put('/resetpassword', (req,res) => {

  if(!req.body.token||req.body.token===''){
    console.log('ERROR!!!')
  }else{
    pool.query("UPDATE users SET password=$1, reset=Null WHERE id=$2 AND reset=$3",
                  [req.body.password, req.body.userId, req.body.token], (error, results) => {
                    if(error){
                      console.log(error)
                    }else{
                      res.status(200).send(results)
                    }
                  })
  }
})

router.post('/units', verifyToken, (req,res) => {
  console.log('post units');

  pool.query('INSERT INTO units (naam, type, duizendste, voorschot, fk_gebouw) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [req.body.naam, req.body.type, req.body.duizendste, req.body.voorschot, req.gebouw], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send(results);
                  }
                })
})

router.put('/units', verifyToken, (req,res) => {
  console.log('put units');

  pool.query("UPDATE units SET naam=$1, type=$2, duizendste=$3, voorschot= $4 WHERE id=$5 RETURNING id",
                [req.body.naam, req.body.type, req.body.duizendste, req.body.voorschot, req.body.id], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send(results);
                  }
                })
})

router.get('/units', verifyToken, (req, res) =>{
  console.log('get units');

  let queryString = "SELECT units.id as id, units.naam as naam, units.type as type, units.duizendste as duizendste,"+
                    "partners.naam as eigenaar, partners.id as eigenaarid from units " +
                    "LEFT OUTER JOIN eigendom ON units.id = eigendom.unit " +
                    "LEFT OUTER JOIN partners ON eigendom.eigenaar = partners.id " +
                    "WHERE units.fk_gebouw = $1 ORDER BY units.naam";

  pool.query(queryString, [req.gebouw], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      res.status(200).send(results.rows);
    }
  })

});

router.get('/unit', verifyToken, (req, res) =>{
  console.log('get unit');

  pool.query('SELECT id, naam, type, duizendste, voorschot from units WHERE id = $1', [req.query.id], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      res.status(200).send(results.rows[0]);
    }
  })

});


router.post('/eigenaars', verifyToken, (req, res) => {

  pool.query("INSERT INTO partners (naam, voornaam, bankrnr, email, overgenomen_saldo_werk, overgenomen_saldo_reserve, fk_type, fk_gebouw) VALUES ($1, $2, $3, $4, $5, $6, 1, $7) RETURNING id",
                [req.body.naam, req.body.voornaam, req.body.bankrnr,
                   req.body.email, req.body.overgenomen_werkrekening, req.body.overgenomen_reserverekening, req.gebouw], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    createEigendom(req, res, results.rows[0].id, req.body.unitFK, req.gebouw);
                  }
                })
})

function createEigendom(req, res, eigenaarId, unitId, gebouwId) {

  pool.query('INSERT INTO eigendom (eigenaar, unit, fk_gebouw) VALUES ($1, $2, $3) RETURNING id',
                [eigenaarId, unitId, gebouwId], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send({id:eigenaarId});
                  }
                })

}

router.post('/eigendom', verifyToken, (req, res)=>{
  console.log('POST eigendom')
  // console.log(req.body)

  pool.query('INSERT INTO eigendom (eigenaar, unit, fk_gebouw) VALUES ($1, $2) RETURNING id',
              [req.body.eigenaar, req.body.unit, req.gebouw], (error, results)=>{
                if(error) console.log(error)
                else res.status(200).send(results)
              })
})

router.put('/eigendom', verifyToken, (req, res)=>{
  console.log('PUT eigendom')
  // console.log(req.body)

  pool.query('UPDATE eigendom set eigenaar=$1 WHERE unit=$2',
              [req.body.eigenaar, req.body.unit], (error, results)=>{
                if(error) console.log(error)
                else res.status(200).send({'status':'OK'})
              })
})

router.put('/eigenaars', verifyToken, (req,res) => {
  console.log('put eigenaars');

  pool.query("UPDATE partners SET naam=$1, voornaam=$2, email=$3, bankrnr=$4, overgenomen_saldo_werk=$5, overgenomen_saldo_reserve=$6 WHERE id=$7 RETURNING id",
                [req.body.naam, req.body.voornaam, req.body.email,
                   req.body.bankrnr, req.body.overgenomen_werkrekening, req.body.overgenomen_reserverekening, req.body.id], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send(results);
                  }
                })
})

router.get('/eigenaar', verifyToken, (req, res) =>{
  console.log('get unit');

  let queryString = "SELECT id, naam, voornaam, email,"+
                    "overgenomen_saldo_werk as overgenomen_werkrekening, "+
                    "overgenomen_saldo_reserve as overgenomen_reserverekening, bankrnr from partners WHERE id = $1"

  pool.query(queryString, [req.query.id], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      res.status(200).send(results.rows[0]);
    }
  })

});

router.get('/eigenaars', verifyToken, (req, res) =>{
  console.log('get eigenaars');

  let queryString = 'SELECT id, naam, voornaam, email, bankrnr, '+
                    'overgenomen_saldo_werk as overgenomen_werkrekening, overgenomen_saldo_reserve as overgenomen_reserverekening '+
                    'FROM partners WHERE fk_gebouw = $1 AND fk_type=1'

  pool.query(queryString, [req.gebouw], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      res.status(200).send(results.rows);
    }
  })

});

router.get('/uittreksels', verifyToken, async function (req,res){
  console.log('get uittreksels');

  const resultRekeningen = await pool.query("SELECT werkrekeningnummer, reserverekeningnummer FROM gebouwen WHERE id=$1",[req.gebouw]);

  let rekeningnummer = ""
  if(req.query.type=='werk') rekeningnummer = resultRekeningen.rows[0].werkrekeningnummer
  if(req.query.type=='reserve') rekeningnummer = resultRekeningen.rows[0].reserverekeningnummer

  let queryString = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type FROM bankrekeninguittreksels as bu " +
                      "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
                      "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
                      "WHERE bu.bankrekening= $1 AND bu.fk_gebouw=$2 ORDER BY bu.datum DESC;"

  const resultUittreksels = await pool.query(queryString, [rekeningnummer, req.gebouw]);

  res.status(200).send(resultUittreksels.rows)
})

router.get('/uittreksel', verifyToken, (req,res)=>{
  console.log('get uittreksel');

  let queryString = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, pa.naam as tegenpartij, bu.omschrijving, kt.naam as type, bu.fk_type as fk_type FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN partners as pa on bu.fk_partner = pa.id " +
                    "LEFT OUTER JOIN kosten_types as kt on bu.fk_type = kt.id " +
                    "WHERE bu.id = ($1);"

  pool.query(queryString, [req.query.id], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      res.status(200).send(results.rows);
    }
  })
})

router.get('/ongekoppelde_uittreksels', verifyToken, async function(req,res){
  console.log('get ongekoppelde uittreksels');

  const resultRekeningen = await pool.query("SELECT werkrekeningnummer, reserverekeningnummer FROM gebouwen WHERE id=$1",[req.gebouw]);

  let queryString = "SELECT id, datum, bedrag, tegenrekening, omschrijving " +
                    "FROM bankrekeninguittreksels " +
                    "WHERE bankrekening = $1 AND fk_partner is Null AND fk_gebouw=$2;"

  const results = await pool.query(queryString, [resultRekeningen.rows[0].werkrekeningnummer, req.gebouw])

  res.status(200).send(results.rows);
})

router.post('/partners', verifyToken, (req, res) => {
  pool.query("INSERT INTO partners (naam, bankrnr, fk_type, fk_gebouw) VALUES ($1, $2, $3, $4) RETURNING id",
                [req.body.naam, req.body.rekeningnummer, req.body.fk_type, req.gebouw], (error, results) => {
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


  pool.query("UPDATE bankrekeninguittreksels SET fk_partner=$1, fk_type=$2 WHERE tegenrekening=$3",
                [req.body.id, req.body.fk_type, req.body.rekeningnummer], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send(results);
                  }
                })

})

router.put('/uittreksel', verifyToken, (req,res) => {
  console.log('put uittreksel');
  console.log(req.body);


  pool.query("UPDATE bankrekeninguittreksels SET fk_type=$1, bedrag=$2 WHERE id=$3",
                [req.body.type, req.body.bedrag, req.body.id], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send(results);
                  }
                })

})

router.get('/kostentypes', verifyToken, (req,res) => {
  console.log('kostentypes');
  pool.query("SELECT id, naam, verdeling from kosten_types WHERE fk_gebouw = $1 and id>1",
              [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results);
                }
              })
})

router.get('/kostentype', verifyToken, (req,res) => {
  console.log('kostentype');
  pool.query("SELECT id, naam, verdeling from kosten_types WHERE fk_gebouw = $1 and id=$2",
              [req.gebouw, req.query.id], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results);
                }
              })
})

router.put('/kostentypeverdeling', verifyToken, (req,res) => {
  console.log('kostentypeverdeling');
  console.log(req.body);
  pool.query("UPDATE kosten_types SET verdeling=$1 WHERE fk_gebouw = $2",
              [req.body.verdeling, req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results);
                }
              })
})

router.put('/kostentype', verifyToken, (req,res) => {
  console.log('kostentype');
  console.log(req.body);
  pool.query("UPDATE kosten_types SET naam=$1, verdeling=$2 WHERE fk_gebouw = $3 and id=$4",
              [req.body.naam, req.body.verdeling, req.gebouw, req.body.id], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results);
                }
              })
})

router.post('/kostentypes', verifyToken, (req,res) => {
  console.log("POST kostentypes")
  pool.query("INSERT INTO kosten_types (naam, verdeling, fk_gebouw) VALUES ($1,$2,$3) RETURNING id",
              [req.body.naam,req.body.verdeling,req.gebouw], (error, results) => {
                if(error){
                  console.log(error)
                }else{
                  res.status(200).send(results)
                }
              })
})

router.post('/aangepasteverdeling', verifyToken, (req,res) => {
  console.log("POST aangepasteverdeling")
  req.body.forEach((element)=>{

    pool.query("INSERT INTO verdeling (fk_unit, fk_kostentype, teller) VALUES ($1,$2,$3) RETURNING id",
            [element.unitFK, element.kostentypeFK, element.teller], (error, results) =>{
              if(error) console.log(error)
              else console.log(results)
            }
          )
  })
  res.status(200).send({'status':'OK'})
})

router.put('/aangepasteverdeling', verifyToken, async function (req,res){
  console.log("PUT aangepasteverdeling")
  console.log(req.body)

  //check for existing verdeling
  const qVerdeling = "SELECT * FROM verdeling WHERE fk_kostentype=$1"
  const rVerdeling = await pool.query(qVerdeling,[req.body[0].kostentypeFK])

  console.log(rVerdeling)

  if(rVerdeling.rows[0]){
    req.body.forEach((element)=>{
      pool.query("UPDATE verdeling SET teller=$1 WHERE fk_unit=$2 AND fk_kostentype=$3",
              [element.teller, element.unitFK, element.kostentypeFK], (error, results) =>{
                if(error) console.log(error)
                else console.log(results)
              }
            )
    })
  }else{
    req.body.forEach((element)=>{
      pool.query("INSERT INTO verdeling (fk_unit, fk_kostentype, teller) VALUES ($1,$2,$3) RETURNING id",
              [element.unitFK, element.kostentypeFK, element.teller], (error, results) =>{
                if(error) console.log(error)
                else console.log(results)
              }
            )
    })
  }

  res.status(200).send({'status':'OK'})
})


router.get('/aangepasteverdeling', verifyToken, (req,res) => {
  console.log("GET aangepasteverdeling")

  let queryString = "SELECT teller FROM verdeling "+
                    "WHERE fk_kostentype=$1 AND fk_unit=$2"

  pool.query(queryString,
          [req.query.kostentypeFK, req.query.unitFK], (error, results) =>{
            if(error) console.log(error)
            else res.status(200).send(results)
          }
        )
})

router.get('/alltypes', verifyToken, (req,res) => {
  console.log('alltypes');
  pool.query("SELECT id, naam from kosten_types WHERE fk_gebouw = $1 or fk_gebouw is Null",
              [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results);
                }
              })
})

router.get('/facturen', verifyToken, (req,res) => {
  console.log('facturen');

  let queryString = "SELECT fa.id, fa.bedrag, pa.naam as partner, fa.omschrijving, fa.datum, fa.vervaldatum, fa.betaald "+
                    "FROM facturen as fa "+
                    "LEFT OUTER JOIN partners AS pa ON fa.fk_partner = pa.id "+
                    "WHERE fa.fk_gebouw = $1 ORDER BY fa.datum";
  pool.query(queryString, [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows);
                }
              })
})

router.get('/openfacturen', verifyToken, (req,res) => {
  console.log('facturen');

  let queryString = "SELECT fa.id, fa.bedrag, pa.naam as partner, fa.omschrijving, fa.datum, fa.vervaldatum, fa.betaald "+
                    "FROM facturen as fa "+
                    "LEFT OUTER JOIN partners AS pa ON fa.fk_partner = pa.id "+
                    "WHERE fa.fk_gebouw = $1 and betaald = false ORDER BY fa.datum";
  pool.query(queryString, [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows);
                }
              })
})

router.get('/factuur', verifyToken, (req,res)=>{
  console.log('get factuur');
  console.log(req.query.id);

  let queryString = "SELECT fa.id, fa.bedrag, pa.naam as partner, fa.fk_partner, fa.omschrijving, fa.datum, fa.vervaldatum, fa.betaald " +
                    "FROM facturen as fa " +
                    "LEFT OUTER JOIN partners AS pa ON fa.fk_partner = pa.id " +
                    "WHERE fa.id = ($1);"

  pool.query(queryString, [req.query.id], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      console.log(results.rows);
      res.status(200).send(results.rows);
    }
  })
})

router.get('/voorschotten', verifyToken, (req,res) => {
  console.log('voorschotten');

  let queryString = "SELECT vo.id, vo.bedrag, pa.naam as partner, vo.omschrijving, vo.datum, vo.vervaldatum, vo.betaald, vo.aangemaand "+
                    "FROM voorschotten as vo "+
                    "LEFT OUTER JOIN partners AS pa ON vo.fk_partner = pa.id "+
                    "WHERE vo.fk_gebouw = $1 ORDER BY vo.datum";
  pool.query(queryString, [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows);
                }
              })
})

router.get('/openvoorschotten', verifyToken, (req,res) => {
  console.log('openvoorschotten');

  let queryString = "SELECT vo.id, vo.bedrag, pa.naam as partner, vo.omschrijving, vo.datum, vo.vervaldatum, vo.betaald "+
                    "FROM voorschotten as vo "+
                    "LEFT OUTER JOIN partners AS pa ON vo.fk_partner = pa.id "+
                    "WHERE vo.fk_gebouw = $1 and vo.betaald = false ORDER BY vo.datum";
  pool.query(queryString, [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows);
                }
              })
})

router.post('/voorschotten', verifyToken, async function (req,res){

  //check secret_key

  //loop over gebouwen

  //check datum
  let today = new Date()
  console.log(today)

  let month = String(today.getMonth() + 1).padStart(2, '0');
  console.log(month)

  let description = ""

  switch (month) {
    case "01":
      description = "Voorschot januari";
      break;
    case "02":
      description = "Voorschot februari";
      break;
    case "03":
      description = "Voorschot maart";
      break;
    case "04":
      description = "Voorschot april";
      break;
    case "05":
      description = "Voorschot mei";
      break;
    case "06":
      description = "Voorschot juni";
      break;
    case "07":
      description = "Voorschot juli";
      break;
    case "08":
      description = "Voorschot augustus";
      break;
    case "09":
      description = "Voorschot september";
      break;
    case "10":
      description = "Voorschot oktober";
      break;
    case "11":
      description = "Voorschot november";
      break;
    case "12":
      description = "Voorschot december";
    }

  console.log(description)

  //get units for gebouw
  const qUnits = "SELECT un.voorschot, un.id, ei.eigenaar FROM units AS un " +
                 "LEFT OUTER JOIN eigendom as ei ON ei.unit = un.id " +
                 "WHERE un.fk_gebouw=$1"
  const rUnits = await pool.query(qUnits, [req.body.fk_gebouw])

  console.log(rUnits.rows)

  for(let element of rUnits.rows){
    createVoorschot(element.voorschot, description, element.eigenaar, element.id, req.body.fk_gebouw)
  }

  //call create voorschot function
    //voorschotbedrag, omschrijving, datum, vervaldatum, fk_partner, fk_unit, gebouwid, type='voorschot'

})

async function createVoorschot(bedrag, omschrijving, fk_partner, fk_unit, fk_gebouw) {

  let today = new Date();
  let dd = String(today.getDate()).padStart(2, '0');
  let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
  let yyyy = today.getFullYear();

  today = yyyy + '/' + mm + '/' + dd;

  voorschotID = null;

  const results1 = await pool.query("INSERT INTO voorschotten (bedrag, omschrijving, datum, vervaldatum, fk_partner, fk_unit, fk_gebouw, type, betaald) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false ) RETURNING id",
                [bedrag, omschrijving, today, today, fk_partner, fk_unit, fk_gebouw, 'voorschot']);

  voorschotID = results1.rows[0].id;

  //check voor 1 op 1 match met bankrekeninguittreksels
  const results2 = await pool.query("SELECT id FROM bankrekeninguittreksels WHERE linked=false and fk_partner = $1 and bedrag = $2 AND fk_gebouw = $3",
              [fk_partner, bedrag, fk_gebouw]);

  let match = false;
  let doublematch = false;

  if(results2.rows[0]){
    await pool.query("UPDATE voorschotten SET betaald=true WHERE id = $1", [voorschotID]);
    await pool.query("UPDATE bankrekeninguittreksels SET linked=true WHERE id = $1", [results2.rows[0].id]);
    await pool.query("INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)", [results2.rows[0].id, voorschotID]);
    match = true
  }

  // probeer voorschot te matchen met 2 bankuittreksels
  if(!match){
    const results3 = await pool.query("SELECT * FROM bankrekeninguittreksels WHERE linked=false and fk_partner = $1 AND fk_gebouw = $2",
                [fk_partner, fk_gebouw]);

    for(let element of results3.rows){
      if(!doublematch){
        for(let element2 of results3.rows){
          if((parseFloat(element.bedrag)+parseFloat(element2.bedrag)==req.body.bedrag)&&(element.id!==element2.id)){
            await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[element.id, voorschotID]);
            await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[element2.id, voorschotID]);
            await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1', [voorschotID]);
            await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element.id]);
            await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element2.id]);
            doublematch = true
            break;
          }
        }
      }
    }
  }

}

router.post('/voorschot', verifyToken, async function (req,res){

  voorschotID = null;

  const results1 = await pool.query("INSERT INTO voorschotten (bedrag, omschrijving, datum, vervaldatum, fk_partner, fk_unit, fk_gebouw, type, betaald) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false ) RETURNING id",
                [req.body.bedrag, req.body.omschrijving, req.body.datum, req.body.vervaldatum, req.body.fk_partner, req.body.fk_unit, req.gebouw, req.body.type]);

  voorschotID = results1.rows[0].id;

  //check voor 1 op 1 match met bankrekeninguittreksels
  const results2 = await pool.query("SELECT id FROM bankrekeninguittreksels WHERE linked=false and fk_partner = $1 and bedrag = $2 AND fk_gebouw = $3",
              [req.body.fk_partner, req.body.bedrag, req.gebouw]);

  let match = false;
  let doublematch = false;

  if(results2.rows[0]){
    await pool.query("UPDATE voorschotten SET betaald=true WHERE id = $1", [voorschotID]);
    await pool.query("UPDATE bankrekeninguittreksels SET linked=true WHERE id = $1", [results2.rows[0].id]);
    await pool.query("INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)", [results2.rows[0].id, voorschotID]);
    match = true
  }

  // probeer voorschot te matchen met 2 bankuittreksels
  if(!match){
    const results3 = await pool.query("SELECT * FROM bankrekeninguittreksels WHERE linked=false and fk_partner = $1 AND fk_gebouw = $2",
                [req.body.fk_partner, req.gebouw]);

    for(let element of results3.rows){
      if(!doublematch){
        for(let element2 of results3.rows){
          if((parseFloat(element.bedrag)+parseFloat(element2.bedrag)==req.body.bedrag)&&(element.id!==element2.id)){
            await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[element.id, voorschotID]);
            await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[element2.id, voorschotID]);
            await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1', [voorschotID]);
            await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element.id]);
            await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element2.id]);
            doublematch = true
            break;
          }
        }
      }
    }
  }

  res.status(200).send(results2);

})

router.post('/facturen', verifyToken, async function (req,res){

  factuurID = null;

  const results1 = await pool.query("INSERT INTO facturen (bedrag, omschrijving, datum, vervaldatum, fk_partner, fk_gebouw, betaald) VALUES ($1, $2, $3, $4, $5, $6, false) RETURNING id",
                [req.body.bedrag, req.body.omschrijving, req.body.datum, req.body.vervaldatum, req.body.fk_partner, req.gebouw]);

  factuurID = results1.rows[0].id;

  //check of deze factuur kan gelinkt worden aan bankuittreksels
  const f_result = await pool.query('SELECT id, bedrag, fk_partner FROM bankrekeninguittreksels WHERE linked = false AND fk_partner = $1 AND fk_gebouw = $2 ORDER BY datum', [req.body.fk_partner, req.gebouw]);

  let match = false;
  let doublematch = false;

  //loop over niet gelinkte bankrekeninguittreksels voor deze leverancier
  for(let element of f_result.rows){
    if(parseFloat(element.bedrag)==-req.body.bedrag){
      console.log('match')
      const results2 = await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[element.id,factuurID]);
      const results3 = await pool.query('UPDATE facturen SET betaald = true WHERE id=$1', [factuurID]);
      const results4 = await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element.id]);
      match = true;
      break;
    }
  }

  if(!match){

    // loop over over niet gelinkte bankrekeninguittreksels voor deze leverancier en link desgevallend met 2 uittreksels
    for(let element of f_result.rows){
      if(!doublematch){
        for(let element2 of f_result.rows){
          if((parseFloat(element.bedrag)+parseFloat(element2.bedrag)==-req.body.bedrag)&&(element.id!==element2.id)){
            console.log('double match')
            await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[element.id, factuurID]);
            await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[element2.id, factuurID]);
            await pool.query('UPDATE facturen SET betaald = true WHERE id=$1', [factuurID]);
            await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element.id]);
            await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element2.id]);
            doublematch = true
            break;
          }
        }
      }
    }
  }

  if(!match&&!doublematch) {

    //loop over niet betaalde facturen en link desgevallend de nieuwe factuur met een oude factuur aan 1 uittreksel
    const f_result2 = await pool.query('SELECT id, bedrag, fk_partner FROM facturen WHERE betaald = false AND fk_partner = $1 AND fk_gebouw = $2 AND id != $3 ORDER BY datum', [req.body.fk_partner, req.gebouw, factuurID]);

    for(let element of f_result.rows){ //uittreksels
      for(let element2 of f_result2.rows){ //facturen
        if(req.body.bedrag+parseFloat(element2.bedrag) == -parseFloat(element.bedrag)){
          console.log('triple match')
          await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[element.id, factuurID]);
          await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[element.id, element2.id]);
          await pool.query('UPDATE facturen SET betaald = true WHERE id=$1', [factuurID]);
          await pool.query('UPDATE facturen SET betaald = true WHERE id=$1', [element2.id]);
          await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element.id]);
          break;
        }
      }
    }

  }

  res.status(200).send(results1);

})

router.put('/facturen', verifyToken, async function (req, res) {
  console.log('put facturen')

  let queryString = "UPDATE facturen SET bedrag=$1, fk_partner=$2, omschrijving=$3, datum=$4, vervaldatum=$5 " +
                    "WHERE id=$6"

  await pool.query(queryString, [req.body.bedrag, req.body.fk_partner, req.body.omschrijving, req.body.datum, req.body.vervaldatum, req.body.id])

  //check of deze aangepaste factuur kan gelinkt worden aan bankuittreksels
  const f_result = await pool.query('SELECT id, bedrag, fk_partner FROM bankrekeninguittreksels WHERE linked = false AND fk_partner = $1 AND fk_gebouw = $2 ORDER BY datum', [req.body.fk_partner, req.gebouw]);

  let match=false;
  let doublematch=false;

  //loop over niet gelinkte bankrekeninguittreksels voor deze leverancier
  for(let element of f_result.rows){
    if(parseFloat(element.bedrag)==-req.body.bedrag){
      console.log('match')
      const results2 = await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[element.id,req.body.id]);
      const results3 = await pool.query('UPDATE facturen SET betaald = true WHERE id=$1', [req.body.id]);
      const results4 = await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element.id]);
      match=true
      break;
    }
  }

  if(!match){

    // loop over over niet gelinkte bankrekeninguittreksels voor deze leverancier en link desgevallend met 2 uittreksels
    for(let element of f_result.rows){
      if(!doublematch){
        for(let element2 of f_result.rows){

          if((parseFloat(element.bedrag)+parseFloat(element2.bedrag)==-req.body.bedrag)&&(element.id!==element2.id)){
            console.log('double match')
            await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[element.id, req.body.id]);
            await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[element2.id, req.body.id]);
            await pool.query('UPDATE facturen SET betaald = true WHERE id=$1', [req.body.id]);
            await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element.id]);
            await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element2.id]);
            doublematch = true
            break;
          }
        }
      }
    }
  }

  res.status(200).send({'status':'OK'})

})


router.get('/leveranciers', verifyToken, (req,res) => {
  console.log('leveranciers');
  pool.query("SELECT id, naam FROM partners WHERE fk_gebouw = $1 and fk_type>1",
              [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows);
                }
              })
})

// router.post('/instellingen', verifyToken, (req, res) => {
//
//   const queryString = "INSERT INTO instellingen (adres, periodiciteit_voorschot, dag_voorschot, " +
//                       "kosten, nieuw, werkrekeningnummer, overgenomen_werkrekening, reserverekeningnummer, " +
//                       "overgenomen_reserverekening, fk_gebouw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id"
//
//   pool.query(queryString, [req.body.adres, req.body.periodiciteit, req.body.voorschotdag,
//                             req.body.kosten, req.body.nieuw, req.body.werkrekeningnummer,
//                             req.body.overgenomen_werkrekening, req.body.reserverekeningnummer,
//                             req.body.overgenomen_reserverekening, req.gebouw], (error, results) => {
//                               if(error){
//                                 console.log(error);
//                               }else{
//                                 res.status(200).send(results);
//                               }
//                             })
// })

// router.post('/verbruiken', verifyToken, (req,res) => {
//   console.log('post verbruiken');
//
//   let queryString = "INSERT INTO verbruiken (van, tot, totaalverbruik, afgerekend, fk_type, fk_gebouw) "+
//                     "VALUES ($1, $2, $3, $4, $5, $6) RETURNING id"
//
//   pool.query(queryString, [req.body.van, req.body.tot, req.body.totaalverbruik, req.body.afgerekend, req.body.fk_type, req.gebouw], (error, results) => {
//                 if(error){
//                   console.log(error);
//                 }else{
//                   res.status(200).send(results);
//                 }
//               })
// })

router.post('/verbruikitems', verifyToken, (req,res) => {
  console.log('post verbruikitems');

  req.body.forEach((element)=>{

    pool.query("INSERT INTO verbruik_items (verbruik_fk, unit_fk, verbruikt) VALUES ($1,$2,$3) RETURNING id",
            [element.verbruik_fk, element.unit_fk, element.verbruikt], (error, results) =>{
              if(error) console.log(error)
              else console.log(results)
            }
          )
  })
  res.status(200).send({'status':'OK'})
})

router.get('/verbruiken', verifyToken, (req,res) => {
  console.log('get verbruiken');

  let queryString = "SELECT ve.id, ve.afgerekend, ve.fk_kostentype, ko.naam AS kostentype, ve.fk_partner, pa.naam AS partner, datum "+
                    "FROM verbruiken as ve "+
                    "LEFT OUTER JOIN kosten_types AS ko ON ve.fk_kostentype = ko.id "+
                    "LEFT OUTER JOIN partners AS pa ON ve.fk_partner = pa.id "+
                    "WHERE ve.fk_gebouw = $1 ORDER BY id";
  pool.query(queryString, [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows);
                }
              })
})

router.get('/verbruik', verifyToken, (req,res) => {
  console.log('get verbruik');

  let queryString = "SELECT ve.id, ve.afgerekend, ve.totaalverbruik, ve.fk_kostentype, ko.naam AS kostentype, ve.fk_partner, pa.naam AS partner, datum "+
                    "FROM verbruiken as ve "+
                    "LEFT OUTER JOIN kosten_types AS ko ON ve.fk_kostentype = ko.id "+
                    "LEFT OUTER JOIN partners AS pa ON ve.fk_partner = pa.id "+
                    "WHERE ve.id = $1";
  pool.query(queryString, [req.query.id], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows[0]);
                }
              })
})

router.get('/verbruikitems', verifyToken, (req,res) => {
  console.log('get verbruikitems');

  let queryString = "SELECT vi.id, vi.verbruikt, un.id AS unit_fk, un.naam AS unit "+
                    "FROM verbruik_items as vi "+
                    "LEFT OUTER JOIN units AS un ON vi.unit_fk = un.id "+
                    "WHERE vi.verbruik_fk = $1 ORDER BY un.naam";
  pool.query(queryString, [req.query.id], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows);
                }
              })
})

router.put('/verbruik', verifyToken, (req,res) => {
  console.log('put verbruik');
  console.log(req.body);

  pool.query("UPDATE verbruiken SET totaalverbruik=$1 WHERE id=$2",
              [req.body.totaalverbruik, req.body.id], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results);
                }
              })

  //res.status(200).send({'status':'OK'})
})

router.put('/verbruikitems', verifyToken, (req,res) => {
  console.log("PUT verbruikitems")
  console.log(req.body)

  req.body.forEach((element)=>{

    console.log(element)

    pool.query("UPDATE verbruik_items SET verbruikt=$1 WHERE id=$2",
            [element.verbruikt, element.id], (error, results) =>{
              if(error) console.log(error)
              else console.log(results)
            }
          )
  })
  res.status(200).send({'status':'OK'})
})

router.put('/instellingen', verifyToken, (req, res) => {

  const queryString = "UPDATE gebouwen SET adres=$1, periodiciteit_voorschot=$2, dag_voorschot=$3, " +
                      "kosten=$4, verdeelsleutel=$5, nieuw=$6, overnamedatum=$7, werkrekeningnummer=$8, overgenomen_werkrekening=$9, reserverekeningnummer=$10, " +
                      "overgenomen_reserverekening=$11 WHERE id=$12"

  pool.query(queryString, [req.body.adres, req.body.periodiciteit, req.body.voorschotdag,
                            req.body.kosten || 0, req.body.verdeelsleutel, req.body.nieuw, req.body.overnamedatum, req.body.werkrekeningnummer,
                            req.body.overgenomen_werkrekening, req.body.reserverekeningnummer,
                            req.body.overgenomen_reserverekening, req.gebouw], (error, results) => {
                              if(error){
                                console.log(error);
                              }else{
                                res.status(200).send(results);
                              }
                            })
})

router.get('/instellingen', verifyToken, (req,res) => {

  const queryString = "SELECT * from gebouwen where id = $1"

  pool.query(queryString, [req.gebouw], (error, results) =>{
    if(error) {
      console.log(error)
    }else{
      res.status(200).send(results.rows);
    }
  })

})

router.get('/agenda', verifyToken, (req,res) => {
  const queryString = "SELECT * FROM agenda WHERE fk_gebouw = $1 ORDER BY datum LIMIT 3"

  pool.query(queryString, [req.gebouw], (error, results) => {
    if(error) console.log(error)
    else res.status(200).send(results.rows)
  })
})

//saldi
router.get('/werkrekeningsaldo', verifyToken, async function(req,res){
  let rekeningTot = 0
  let overgenomenTot = 0

  let queryOvergenomen = "SELECT werkrekeningnummer, overgenomen_werkrekening "+
                         "FROM gebouwen WHERE id=$1";

  const resultsOvergenomen = await pool.query(queryOvergenomen, [req.gebouw])

  let queryRekening = "SELECT sum(bedrag) "+
                      "FROM bankrekeninguittreksels "+
                      "WHERE bankrekening=$1 AND fk_gebouw=$2";

  const resultsRekening = await pool.query(queryRekening, [resultsOvergenomen.rows[0].werkrekeningnummer, req.gebouw])

  if(resultsRekening.rows[0].sum)
    rekeningTot = resultsRekening.rows[0].sum

  if(resultsOvergenomen.rows[0].overgenomen_werkrekening)
    overgenomenTot = resultsOvergenomen.rows[0].overgenomen_werkrekening

  let totaal = parseFloat(rekeningTot.toString()) + parseFloat(overgenomenTot.toString())

  res.status(200).send({'sum':totaal})
})

router.get('/reserverekeningsaldo', verifyToken, async function(req,res){
  let rekeningTot = 0
  let overgenomenTot = 0

  let queryOvergenomen = "SELECT reserverekeningnummer, overgenomen_reserverekening "+
                         "FROM gebouwen WHERE id=$1";

  const resultsOvergenomen = await pool.query(queryOvergenomen, [req.gebouw])

  let queryRekening = "SELECT sum(bedrag) "+
                      "FROM bankrekeninguittreksels "+
                      "WHERE bankrekening=$1 AND fk_gebouw=$2";

  const resultsRekening = await pool.query(queryRekening, [resultsOvergenomen.rows[0].reserverekeningnummer, req.gebouw])

  if(resultsRekening.rows[0].sum)
    rekeningTot = resultsRekening.rows[0].sum

  if(resultsOvergenomen.rows[0].overgenomen_reserverekening)
    overgenomenTot = resultsOvergenomen.rows[0].overgenomen_reserverekening

  let totaal = parseFloat(rekeningTot.toString()) + parseFloat(overgenomenTot.toString())

  res.status(200).send({'sum':totaal})

})

router.get('/setup', verifyToken, async function(req, res) {
  console.log('get setup')

  //check instellingen
  let instellingenFilled = true;

  let queryString = "SELECT * FROM gebouwen WHERE id = $1";

  const results = await pool.query(queryString, [req.gebouw]);

  if(!results.rows[0]){
    instellingenFilled = false;
  }else{

    if(!results.rows[0].adres || results.rows[0].adres == '') instellingenFilled = false
    if(!results.rows[0].periodiciteit_voorschot || results.rows[0].periodiciteit_voorschot == '') instellingenFilled = false
    if(!results.rows[0].dag_voorschot || results.rows[0].dag_voorschot == '') instellingenFilled = false
    if(!results.rows[0].werkrekeningnummer || results.rows[0].werkrekeningnummer == '') instellingenFilled = false
    if(!results.rows[0].reserverekeningnummer || results.rows[0].reserverekeningnummer == '') instellingenFilled = false
    if(!results.rows[0].verdeelsleutel || results.rows[0].verdeelsleutel == '') instellingenFilled = false

    if(!results.rows[0].nieuw){
      if(results.rows[0].overgenomen_werkrekening == 0  && results.rows[0].overgenomen_reserverekening == 0) instellingenFilled = false
      if(results.rows[0].overnamedatum == '') instellingenFilled = false
    }

  }

  //check units en duizendsten
  let unitsFilled = true;

  let queryUnits = "SELECT SUM(duizendste), COUNT(*) FROM units WHERE fk_gebouw = $1"

  const resultUnits = await pool.query(queryUnits, [req.gebouw]);

  let queryGebouw = "SELECT verdeelsleutel FROM gebouwen WHERE id = $1"

  const resultGebouw  = await pool.query(queryGebouw, [req.gebouw])

  if(!resultUnits.rows[0] || !resultUnits.rows[0].sum){
    unitsFilled = false
  }else{
    //console.log(resultUnits.rows[0])
    if(resultUnits.rows[0].sum!=resultGebouw.rows[0].verdeelsleutel) unitsFilled = false
  }

  //eigenaars
  let eigenaarsFilled = false

  if(unitsFilled){
    //query units
    let queryEigendom = "SELECT COUNT(*) FROM eigendom WHERE fk_gebouw = $1";
    let resultEigendom = await pool.query(queryEigendom, [req.gebouw]);

    if(resultUnits.rows[0].count===resultEigendom.rows[0].count)
      eigenaarsFilled = true

  }

  // let queryEigenaars = "SELECT * FROM partners WHERE fk_gebouw = $1 AND fk_type = 1"
  //
  // const resultEigenaars = await pool.query(queryEigenaars, [req.gebouw]);
  //
  // if(!resultEigenaars.rows || resultEigenaars.rows.length==0){
  //   eigenaarsFilled = false
  // }else {
  //   let eigenaarsCount = 0;
  //   for(let element of resultEigenaars.rows){
  //     eigenaarsCount++
  //     if(!element.naam || element.naam =='') eigenaarsFilled = false
  //     if(!element.bankrnr || element.bankrnr=='') eigenaarsFilled = false
  //
  //     //console.log(element)
  //   }
  //   if (!resultUnits.rows[0] || !resultUnits.rows[0].count || eigenaarsCount<resultUnits.rows[0].count)
  //     eigenaarsFilled = false
  // }

  //kosten_types
  let kostentypesFilled = true

  let queryKostentypes = "SELECT * FROM kosten_types WHERE fk_gebouw= $1"

  const resultKostentypes = await pool.query(queryKostentypes, [req.gebouw]);

  for(let element of resultKostentypes.rows){
    if(!element.verdeling){
      kostentypesFilled = false
    }
  }


  if(instellingenFilled&&unitsFilled&&eigenaarsFilled&&kostentypesFilled){
    res.status(200).send({'setup':'true'});
  }else{
    if(eigenaarsFilled){
      res.status(200).send({'setup':'eigenaars'});
    }else if(unitsFilled){
      res.status(200).send({'setup':'units'});
    }else if(instellingenFilled){
      res.status(200).send({'setup':'instellingen'});
    }else{
      res.status(200).send({'setup':'false'})
    }
  }
})


//rapporten
router.get('/werkrekeningrapport', verifyToken, async function(req, res) {
  console.log('werkrekeningrapport');

  let rapport = new Map();

  const result = await pool.query('SELECT id, naam, voornaam, email, bankrnr, overgenomen_saldo_werk '+
                                  'FROM partners WHERE fk_gebouw = $1 AND fk_type=1', [req.gebouw]);

  for(let element of result.rows){
    rapport.set(element.naam,{'voorschotten':0,'uitgaven':0,'saldo':0,'vorig_saldo':0 || parseFloat(element.overgenomen_saldo_werk),
                              'totaal':0,'verdeelsleutel':0});
  };

  //set verdeelsleuten voor elke eigenaar
  let queryString = "SELECT units.id as id, units.naam as naam, units.duizendste as duizendste,"+
                    "partners.naam as eigenaar, partners.id as eigenaarid from units " +
                    "LEFT OUTER JOIN eigendom ON units.id = eigendom.unit " +
                    "LEFT OUTER JOIN partners ON eigendom.eigenaar = partners.id " +
                    "WHERE units.fk_gebouw = $1 ORDER BY units.naam";

  const result2 = await pool.query(queryString, [req.gebouw]);

  let qVerdeelsleutel = "SELECT verdeelsleutel FROM gebouwen WHERE id=$1"
  const rVerdeelsleutel = await pool.query(qVerdeelsleutel, [req.gebouw])

  for(let element of result2.rows){
    let myObj = rapport.get(element.eigenaar);
    myObj.verdeelsleutel = myObj.verdeelsleutel + element.duizendste
    rapport.set(element.eigenaar,myObj);
  };

  let queryBankrekeningnr = "SELECT werkrekeningnummer "+
                            "FROM gebouwen WHERE id=$1";

  const resultsBankrekeningnr = await pool.query(queryBankrekeningnr, [req.gebouw])

  //voorschotten en kosten
  let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
                    "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
                    "WHERE bu.bankrekening = ($1) AND bu.fk_gebouw=$2;"

  const result3 = await pool.query(queryString2, [resultsBankrekeningnr.rows[0].werkrekeningnummer, req.gebouw]);

  for(let element of result3.rows){
    //voorschotten
    if(rapport.get(element.tegenpartij)&&element.type=='voorschot'){
      let myObj = rapport.get(element.tegenpartij);
      myObj.voorschotten = myObj.voorschotten+parseFloat(element.bedrag)
      rapport.set(element.tegenpartij,myObj)
    //kosten
    }else{
      //toekennen aan iedere eigenaar
      rapport.forEach(function(value,key){
        let verdeling = (element.bedrag*value.verdeelsleutel)/parseFloat(rVerdeelsleutel.rows[0].verdeelsleutel.toString());
        value.uitgaven = value.uitgaven + verdeling
        rapport.set(key,value);
      });
    }
  }

  let totaalVoorschotten = 0
  let totaalUitgaven = 0
  let totaalSaldo = 0
  let totaalOvergenomensaldo = 0
  let totaalTotaal = 0

  rapport.forEach(function(value,key){
    value.saldo = value.voorschotten + value.uitgaven
    value.totaal = value.saldo + value.vorig_saldo
    rapport.set(key,value);

    totaalVoorschotten = totaalVoorschotten + value.voorschotten
    totaalUitgaven = totaalUitgaven + value.uitgaven
    totaalSaldo = totaalSaldo + value.saldo
    totaalOvergenomensaldo = totaalOvergenomensaldo + value.vorig_saldo
    totaalTotaal = totaalTotaal + value.totaal
  })

  rapport.set('Totaal',{'voorschotten':totaalVoorschotten,
                        'uitgaven':totaalUitgaven,
                        'saldo':totaalSaldo,
                        'vorig_saldo':totaalOvergenomensaldo,
                        'totaal':totaalTotaal});

  console.log(rapport);
  return res.status(200).send(Array.from(rapport));

})

router.get('/inkomstenrapport', verifyToken, async function(req, res) {
  console.log('inkomstenrapport');

  let rapport = new Map();

  //get eigenaars
  const result = await pool.query('SELECT id, naam, voornaam, email, bankrnr, overgenomen_saldo_werk '+
                                  'FROM partners WHERE fk_gebouw = $1 AND fk_type=1', [req.gebouw]);

  for(let element of result.rows){
    rapport.set(element.naam,{'0':0,'1':0,'2':0,'3':0,'4':0,'5':0,
                              '6':0,'7':0,'8':0,'9':0,'10':0,'11':0,'12':0});
  };

  let queryBankrekeningnr = "SELECT werkrekeningnummer "+
                            "FROM gebouwen WHERE id=$1";

  const resBankrekeningnr = await pool.query(queryBankrekeningnr, [req.gebouw])

  //loop over uittreksels
  let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
                    "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
                    "WHERE bu.bankrekening = ($1) AND bu.fk_gebouw = $2;"

  const result2 = await pool.query(queryString2, [resBankrekeningnr.rows[0].werkrekeningnummer, req.gebouw]);

  let t0 = 0
  let t1 = 0
  let t2 = 0
  let t3 = 0
  let t4 = 0
  let t5 = 0
  let t6 = 0
  let t7 = 0
  let t8 = 0
  let t9 = 0
  let t10 = 0
  let t11 = 0
  let t12 = 0

  for(let element of result2.rows){
    let myDate = new Date(element.datum);
    let month = myDate.getMonth()

    if(rapport.get(element.tegenpartij)){

      let myObj = rapport.get(element.tegenpartij);
      myObj[month] = parseFloat(myObj[month]) + parseFloat(element.bedrag.toString());
      myObj[12] = myObj[12] + parseFloat(element.bedrag.toString());

      rapport.set(element.tegenpartij,myObj);

      if(month==0) t0=t0+parseFloat(element.bedrag.toString())
      else if(month==1) t1=t1+parseFloat(element.bedrag.toString())
      else if(month==2) t2=t2+parseFloat(element.bedrag.toString())
      else if(month==3) t3=t3+parseFloat(element.bedrag.toString())
      else if(month==4) t4=t4+parseFloat(element.bedrag.toString())
      else if(month==5) t5=t5+parseFloat(element.bedrag.toString())
      else if(month==6) t6=t6+parseFloat(element.bedrag.toString())
      else if(month==7) t7=t7+parseFloat(element.bedrag.toString())
      else if(month==8) t8=t8+parseFloat(element.bedrag.toString())
      else if(month==9) t9=t9+parseFloat(element.bedrag.toString())
      else if(month==10) t10=t10+parseFloat(element.bedrag.toString())
      else if(month==11) t11=t11+parseFloat(element.bedrag.toString())

      t12 = t12 + parseFloat(element.bedrag.toString())

    }
  }

  rapport.set('Totaal',{'0':t0,'1':t1,'2':t2,'3':t3,'4':t4,'5':t5,
                            '6':t6,'7':t7,'8':t8,'9':t9,'10':t10,'11':t11,'12':t12})

  return res.status(200).send(Array.from(rapport));

})

router.get('/uitgavenrapport', verifyToken, async function(req, res) {
  console.log('uitgavenrapport');

  let rapport = new Map();

  //get eigenaars
  const result = await pool.query('SELECT id, naam, voornaam, email, bankrnr, overgenomen_saldo_werk '+
                                  'FROM partners WHERE fk_gebouw = $1 AND fk_type>1', [req.gebouw]);

  for(let element of result.rows){
    rapport.set(element.naam,{'0':0,'1':0,'2':0,'3':0,'4':0,'5':0,
                              '6':0,'7':0,'8':0,'9':0,'10':0,'11':0,'12':0});
  };

  let queryBankrekeningnr = "SELECT werkrekeningnummer "+
                            "FROM gebouwen WHERE id=$1";

  const resBankrekeningnr = await pool.query(queryBankrekeningnr, [req.gebouw])

  //loop over uittreksels
  let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
                    "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
                    "WHERE bu.bankrekening = ($1) AND bu.fk_gebouw = $2;"

  const result2 = await pool.query(queryString2, [resBankrekeningnr.rows[0].werkrekeningnummer, req.gebouw]);

  let t0 = 0
  let t1 = 0
  let t2 = 0
  let t3 = 0
  let t4 = 0
  let t5 = 0
  let t6 = 0
  let t7 = 0
  let t8 = 0
  let t9 = 0
  let t10 = 0
  let t11 = 0
  let t12 = 0

  for(let element of result2.rows){
    let myDate = new Date(element.datum);
    let month = myDate.getMonth()

    if(rapport.get(element.tegenpartij)){

      let myObj = rapport.get(element.tegenpartij);
      myObj[month] = parseFloat(myObj[month]) + parseFloat(element.bedrag.toString());
      myObj[12] = myObj[12] + parseFloat(element.bedrag.toString());

      rapport.set(element.tegenpartij,myObj);

      if(month==0) t0=t0+parseFloat(element.bedrag.toString())
      else if(month==1) t1=t1+parseFloat(element.bedrag.toString())
      else if(month==2) t2=t2+parseFloat(element.bedrag.toString())
      else if(month==3) t3=t3+parseFloat(element.bedrag.toString())
      else if(month==4) t4=t4+parseFloat(element.bedrag.toString())
      else if(month==5) t5=t5+parseFloat(element.bedrag.toString())
      else if(month==6) t6=t6+parseFloat(element.bedrag.toString())
      else if(month==7) t7=t7+parseFloat(element.bedrag.toString())
      else if(month==8) t8=t8+parseFloat(element.bedrag.toString())
      else if(month==9) t9=t9+parseFloat(element.bedrag.toString())
      else if(month==10) t10=t10+parseFloat(element.bedrag.toString())
      else if(month==11) t11=t11+parseFloat(element.bedrag.toString())

      t12 = t12 + parseFloat(element.bedrag.toString())
    }
  }

  rapport.set('Totaal',{'0':t0,'1':t1,'2':t2,'3':t3,'4':t4,'5':t5,
                            '6':t6,'7':t7,'8':t8,'9':t9,'10':t10,'11':t11,'12':t12})

  console.log(rapport);
  return res.status(200).send(Array.from(rapport));

})

router.get('/balans', verifyToken, async function(req, res) {
  console.log('balans');

  let rapport = {};

  //openstaande voorschotten
  let queryString = "SELECT voorschotten.id, voorschotten.bedrag, partners.naam FROM voorschotten "+
                    "LEFT OUTER JOIN partners ON voorschotten.fk_partner = partners.id "+
                    "WHERE voorschotten.fk_gebouw = $1 AND voorschotten.betaald=false";

  const result = await pool.query(queryString, [req.gebouw]);

  let vorderingenTotaal = 0
  rapport.vorderingen_detail = []

  for (let element of result.rows){
    rapport.vorderingen_detail.push({'naam':element.naam,'bedrag':element.bedrag});
    vorderingenTotaal = vorderingenTotaal + parseFloat(element.bedrag);
  }

  rapport.vorderingen = vorderingenTotaal;

  let queryOvergenomen = "SELECT werkrekeningnummer, overgenomen_werkrekening "+
                          "FROM gebouwen WHERE id=$1";

  const resOvergenomen = await pool.query(queryOvergenomen, [req.gebouw])

  //bankrekening
  let queryString2 = "SELECT SUM(bedrag) as som FROM bankrekeninguittreksels "+
                    "WHERE bankrekening = $1 AND fk_gebouw=$2";

  const result2 = await pool.query(queryString2, [resOvergenomen.rows[0].werkrekeningnummer, req.gebouw]);

  let uittrekselsaldo = 0
  if(result2.rows[0].som)
    uittrekselsaldo = parseFloat(result2.rows[0].som.toString())

  let overgenomensaldo = 0
  if(resOvergenomen.rows[0].overgenomen_werkrekening)
    overgenomensaldo = parseFloat(resOvergenomen.rows[0].overgenomen_werkrekening.toString())

  rapport.bank = uittrekselsaldo + overgenomensaldo;

  //openstaande leveranciers
  let queryString3 = "SELECT facturen.id, facturen.bedrag, partners.naam FROM facturen "+
                    "LEFT OUTER JOIN partners ON facturen.fk_partner = partners.id "+
                    "WHERE facturen.fk_gebouw = $1 AND facturen.betaald=false";

  const result3 = await pool.query(queryString3, [req.gebouw]);

  let leveranciersTotaal = 0
  rapport.leveranciers_detail = []

  for (let element of result3.rows){
    rapport.leveranciers_detail.push({'naam':element.naam,'bedrag':element.bedrag});
    leveranciersTotaal = leveranciersTotaal - parseFloat(element.bedrag);
  }

  rapport.leveranciers = -leveranciersTotaal;

  rapport.teveelvoorschotten = parseFloat(rapport.bank) + parseFloat(rapport.vorderingen) - parseFloat(rapport.leveranciers)

  rapport.totaal_activa = parseFloat(rapport.bank) + parseFloat(rapport.vorderingen)

  rapport.totaal_passiva = parseFloat(rapport.leveranciers) + parseFloat(rapport.teveelvoorschotten)

  //console.log(rapport)

  // let rapport = {'vorderingen': {
  //                   'totaal':100,
  //                   'eigenaar1':50,
  //                   'eigenaar2':50},
  //                 'bank':250,
  //                 'leveranciers': {
  //                   'totaal':500,
  //                   'leverancier1':400,
  //                   'leverancier2':100},
  //                 'teveelontvangen':250
  //               }

  // let rapport = {
  //  'vorderingen':500,
  //  'bank': 400,
  //  'vorderingen_detail':[{'naam':'test1','bedrag':100},{'naam':'test2','bedrag':200}]
  // }

  //console.log(rapport);
  return res.status(200).send(rapport);

})

router.get('/inkomsten', verifyToken, async function(req,res){

  let queryBankrekeningnr = "SELECT werkrekeningnummer "+
                            "FROM gebouwen WHERE id=$1";

  const resultsBankrekeningnr = await pool.query(queryBankrekeningnr, [req.gebouw])

  const queryString = "SELECT date_trunc( 'month', datum ), SUM(bedrag) "+
                      "FROM bankrekeninguittreksels "+
                      "WHERE bankrekening = $1 AND fk_gebouw=$2 AND bedrag > 0 "+
                      "GROUP BY date_trunc( 'month', datum ) ORDER BY date_trunc( 'month', datum );"

  const results = await pool.query(queryString, [resultsBankrekeningnr.rows[0].werkrekeningnummer,req.gebouw])

  res.status(200).send(results)

})

router.get('/uitgaven', verifyToken, async function(req,res){

  let queryBankrekeningnr = "SELECT werkrekeningnummer "+
                            "FROM gebouwen WHERE id=$1";

  const resultsBankrekeningnr = await pool.query(queryBankrekeningnr, [req.gebouw])

  const queryString = "SELECT date_trunc( 'month', datum ), SUM(bedrag) "+
                      "FROM bankrekeninguittreksels "+
                      "WHERE bankrekening = $1 AND fk_gebouw=$2 AND bedrag < 0 "+
                      "GROUP BY date_trunc( 'month', datum ) ORDER BY date_trunc( 'month', datum );"

  const results = await pool.query(queryString, [resultsBankrekeningnr.rows[0].werkrekeningnummer,req.gebouw])

  res.status(200).send(results)

})

router.get('/preview', verifyToken, async function(req,res){

  //definieer array zoals voor de rapporten
  let results = []

  //get gebouw algemene verdeelsleutel
  const queryGebouw = "SELECT verdeelsleutel FROM gebouwen WHERE id = $1"

  const resultsGebouw = await pool.query(queryGebouw, [req.gebouw])

  //get units en hun duizendste
  const queryUnits = "SELECT * FROM units WHERE fk_gebouw = $1"

  const resultsUnits = await pool.query(queryUnits, [req.gebouw])

  //get bankrekeninguittreksels
  const queryUittreksels = "SELECT SUM(ba.bedrag), ko.naam as kostentype, ko.id, ko.verdeling FROM bankrekeninguittreksels AS ba "+
                         "LEFT OUTER JOIN kosten_types AS ko ON ba.fk_type = ko.id "+
                         "WHERE ba.datum >= ($1) AND ba.datum <= ($2) AND ba.fk_gebouw = $3 AND ba.fk_type>1 "+
                         "GROUP BY ko.naam, ko.verdeling, ko.id"

  const resultsUittreksels = await pool.query(queryUittreksels, [req.query.van, req.query.tot, req.gebouw])

  //loop over bankrekeninguittreksels
  for(let uittreksel of resultsUittreksels.rows){
    console.log(uittreksel.verdeling)
    //ingeval van standaardverdeling > loop over units en voeg gewoon toe aan array
    if(uittreksel.verdeling=='algemeen'){
      for(let unit of resultsUnits.rows){
        let unitBedrag = parseFloat(uittreksel.sum) * (parseFloat(unit.duizendste) / parseFloat(resultsGebouw.rows[0].verdeelsleutel))
        results.push([unit.naam, uittreksel.kostentype, -uittreksel.sum, unit.duizendste, resultsGebouw.rows[0].verdeelsleutel, -unitBedrag || '0'])
      }
    }

    //ingeval van verbruik > haal de verbruikverdeling op en gebruik deze verdeling om toe te voegen aan array
    if(uittreksel.verdeling=='verbruik'){

      //haal de verbruiksverdeling op
      const queryVerbruik = "SELECT * FROM verbruiken where fk_kostentype = $1"
      const resultVerbruik = await pool.query(queryVerbruik, [uittreksel.id])
      let totaalverbruik = resultVerbruik.rows[0].totaalverbruik

      const queryVerbruikItems = "SELECT * FROM verbruik_items WHERE verbruik_fk = $1"
      const resultVerbruikItems = await pool.query(queryVerbruikItems, [resultVerbruik.rows[0].id])

      for(let unit of resultsUnits.rows){

        for(let verbruik of resultVerbruikItems.rows){
          if(verbruik.unit_fk===unit.id){
            let unitBedrag = parseFloat(uittreksel.sum) * (parseFloat(verbruik.verbruikt) / parseFloat(totaalverbruik))
            results.push([unit.naam, uittreksel.kostentype, -uittreksel.sum, verbruik.verbruikt, totaalverbruik, -unitBedrag || '0'])
          }
        }
      }
    }

    //ingeval van afwijkende verdeling > haal de verdeling op en gebruik deze verdeling om toe te voegen aan array
    if(uittreksel.verdeling=='aangepast'){

      //haal de afwijkende verdeling op
      console.log(uittreksel.id)
      const queryVerdeling = "SELECT * FROM verdeling where fk_kostentype = $1"
      const resultVerdeling = await pool.query(queryVerdeling, [uittreksel.id])

      //haal de verdeelsleutel
      const queryVerdeelsleutel = "SELECT SUM(teller) FROM verdeling where fk_kostentype = $1"
      const resultVerdeelsleutel = await pool.query(queryVerdeelsleutel, [uittreksel.id])
      let verdeelsleutel = resultVerdeelsleutel.rows[0].sum

      for(let unit of resultsUnits.rows){

        for(let verdeling of resultVerdeling.rows){
          if(verdeling.fk_unit===unit.id){
            let unitBedrag = parseFloat(uittreksel.sum) * (parseFloat(verdeling.teller) / parseFloat(verdeelsleutel))
            results.push([unit.naam, uittreksel.kostentype, -uittreksel.sum, verdeling.teller, verdeelsleutel, -unitBedrag || '0'])
          }
        }
      }
    }

  }

  results=results.sort(function(a,b){
      retVal=0;
      if(a[0]!=b[0]) retVal=a[0]>b[0]?1:-1;
      else if(a[1]!=b[1]) retVal=a[1]>b[1]?1:-1;
      else if(a[2]!=b[2]) retVal=a[2]>b[2]?1:-1;
      return retVal
    });

  //generate totals per unit
  let unit = results[0][0]
  let unitTotaal = 0
  let newResults = []

  for(let result of results){

    if(unit!==result[0]){
      //push totaal
      newResults.push([unit, 'Totaal', '','','', unitTotaal])

      //get betaalde voorschotten voor deze unit
      let qGefactureerd = "SELECT SUM(vo.bedrag) FROM voorschotten AS vo "+
                          "LEFT OUTER JOIN units AS un ON vo.fk_unit = un.id "+
                          "WHERE vo.fk_gebouw = $1 AND un.naam = $2 AND datum >= ($3) AND datum <= ($4) AND betaald=true AND vo.type='voorschot'"

      let rGefactureerd = await pool.query(qGefactureerd, [req.gebouw, unit, req.query.van, req.query.tot])
      newResults.push([unit, 'Betaalde voorschotten', '','','', -rGefactureerd.rows[0].sum || '0'])

      //bereken subtotaal
      newResults.push([unit, 'Subtotaal', '','','', unitTotaal - rGefactureerd.rows[0].sum || '0'])

      //get openstaande voorschotten/afrekeningen voor deze unit
      let qOpen = "SELECT SUM(vo.bedrag) FROM voorschotten AS vo "+
                          "LEFT OUTER JOIN units AS un ON vo.fk_unit = un.id "+
                          "WHERE vo.fk_gebouw = $1 AND un.naam = $2 AND betaald=false"

      let rOpen = await pool.query(qOpen, [req.gebouw, unit])
      newResults.push([unit, 'Openstaande voorschotten', '','','', rOpen.rows[0].sum || '0'])

      let gefactureerd = 0
      let open = 0

      if(rGefactureerd.rows[0].sum) gefactureerd = parseFloat(rGefactureerd.rows[0].sum.toString())
      if(rOpen.rows[0].sum) open = parseFloat(rOpen.rows[0].sum.toString())


      //bereken te betalen bedrag
      newResults.push([unit, 'Te betalen', '','','', unitTotaal - gefactureerd + open])

      newResults.push(['','','','','',''])

      unitTotaal = parseFloat(result[5])
      unit = result[0]

    }else{
      unitTotaal = unitTotaal + parseFloat(result[5])
    }

    newResults.push(result)

  }

  newResults.push([unit, 'Totaal', '','','', unitTotaal])

  //get gefactureerde voorschotten voor deze unit
  let qGefactureerd = "SELECT SUM(vo.bedrag) FROM voorschotten AS vo "+
                      "LEFT OUTER JOIN units AS un ON vo.fk_unit = un.id "+
                      "WHERE vo.fk_gebouw = $1 AND un.naam = $2 AND datum >= ($3) AND datum <= ($4) AND betaald=true AND vo.type='voorschot'"

  let rGefactureerd = await pool.query(qGefactureerd, [req.gebouw, unit, req.query.van, req.query.tot])
  newResults.push([unit, 'Betaalde voorschotten', '','','', -rGefactureerd.rows[0].sum || '0'])

  //bereken subtotaal
  newResults.push([unit, 'Subtotaal', '','','', unitTotaal - rGefactureerd.rows[0].sum || '0'])

  //get openstaande voorschotten voor deze unit
  let qOpen = "SELECT SUM(vo.bedrag) FROM voorschotten AS vo "+
                      "LEFT OUTER JOIN units AS un ON vo.fk_unit = un.id "+
                      "WHERE vo.fk_gebouw = $1 AND un.naam = $2 AND datum >= ($3) AND datum <= ($4) AND betaald=false"

  let rOpen = await pool.query(qOpen, [req.gebouw, unit, req.query.van, req.query.tot])
  newResults.push([unit, 'Openstaande voorschotten', '','','', rOpen.rows[0].sum || '0'])

  //bereken te betalen bedrag
  newResults.push([unit, 'Te betalen', '','','', unitTotaal - rGefactureerd.rows[0].sum + rOpen.rows[0].sum])

  res.status(200).send(newResults)

})

router.post('/validate', verifyToken, async function(req,res){
  console.log('post validate');

  const qAfrekening = "INSERT INTO afrekeningen(van, tot, fk_gebouw) VALUES ($1, $2, $3) RETURNING id"
  const rAfrekening = await pool.query(qAfrekening, [req.body.van, req.body.tot, req.gebouw])

  for(let element of req.body.items){
    const qAfrekeningItem = "INSERT INTO afrekening_items (fk_afrekening, unit, type, totaalbedrag, verdeling_teller, verdeling_noemer, bedrag) "+
                            "VALUES ($1, $2, $3, $4, $5, $6, $7)"
    const rAfrekeningItem = await pool.query(qAfrekeningItem, [rAfrekening.rows[0].id, element[0], element[1], element[2], element[3], element[4], element[5]])

    if(element[1]=='Subtotaal'){
      //get current date en vervaldatum
      let today = new Date().toISOString().slice(0, 10)

      //get fk_unit and fk_partner
      const qUnit = "SELECT * FROM units WHERE naam = $1 AND fk_gebouw = $2"
      const rUnit = await pool.query(qUnit, [element[0], req.gebouw])

      const qEigenaar = "SELECT * FROM eigendom WHERE unit=$1 AND fk_gebouw=$2"
      const rEigenaar = await pool.query(qEigenaar, [rUnit.rows[0].id, req.gebouw])

      const qVoorschotten = "INSERT INTO voorschotten (bedrag, fk_partner, omschrijving, fk_gebouw, datum, vervaldatum, betaald, fk_unit, type) "+
                            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id"
      const rVoorschotten = await pool.query(qVoorschotten, [element[5], rEigenaar.rows[0].eigenaar, 'Afrekening', req.gebouw,
                                                            today, today, 'false', rUnit.rows[0].id,'afrekening'])
    }
  }

  const qVerbruiken = "UPDATE verbruiken SET afgerekend = true WHERE fk_gebouw = $1"
  const rVerbruiken = await pool.query(qVerbruiken, [req.gebouw])

  res.status(200).send(rAfrekening)
})

router.get('/generatepdf', verifyToken, async function(req,res){
  console.log('GET generatepdf')

  const PDFDocument = require('pdfkit');

  let doc = null;

  //get units
  const qUnits = "SELECT DISTINCT unit AS naam FROM afrekening_items WHERE fk_afrekening = $1 AND unit != ''"
  const rUnits = await pool.query(qUnits, [req.query.afrekeningID])

  //get afrekening
  const qAfrekening = "SELECT * FROM afrekeningen WHERE id = $1"
  const rAfrekening = await pool.query(qAfrekening, [req.query.afrekeningID])

  vanDate = new Date(rAfrekening.rows[0].van)
  let vDag = vanDate.getDate()
  if(vDag.length==1)
    vDag = '0'+vDag
  let vMaand = vanDate.getMonth()+1
  if(vMaand.length==1)
    vMaand = '0'+vMaand
  let vJaar = vanDate.getFullYear()
  let van = vDag + "/" + vMaand + "/" + vJaar

  totDate = new Date(rAfrekening.rows[0].tot)
  let tDag = totDate.getDate()
  if(tDag.length==1)
    tDag = '0'+tDag
  let tMaand = totDate.getMonth()+1
  if(tMaand.length==1)
    tMaand = '0'+tMaand
  let tJaar = totDate.getFullYear()
  let tot = tDag + "/" + tMaand + "/" + tJaar

  //loop over units
  for (let unit of rUnits.rows){

    doc = new PDFDocument;
    doc.pipe(fs.createWriteStream('generatedpdfs/A'+req.query.afrekeningID+'_Unit'+unit.naam+'.pdf'));

    //get owner gegevens + print
    const qOwner = "SELECT pa.naam, pa.email " +
                    "FROM units AS un " +
                    "LEFT OUTER JOIN eigendom AS ei ON un.id =  ei.unit " +
                    "LEFT OUTER JOIN partners AS pa ON ei.eigenaar = pa.id " +
                    "WHERE un.naam=($1) AND un.fk_gebouw=$2"
    const rOwner = await pool.query(qOwner, [unit.naam, req.gebouw])

    doc.fontSize(14)
       .text(rOwner.rows[0].naam,50,50)
       .text(rOwner.rows[0].email,50,70)

    doc.fontSize(21)
       .text('Afrekening unit '+unit.naam+' van '+van+' tot '+tot,100,120)

    //print de tabel
    const qItems = "SELECT * FROM afrekening_items WHERE fk_afrekening = $1 AND unit = $2 ORDER BY id"
    const rItems = await pool.query(qItems, [req.query.afrekeningID, unit.naam])
    let y = 200

    doc.font('Helvetica-Bold')
      .fontSize(14)
      .text('Kostentype',50,180)
      .text('Totaalbedrag',200,180)
      .text('Verdeelsleutel',350,180)
      .text('Bedrag',455,180)

    let sign = "betalen"

    for(let item of rItems.rows){

      if(item.totaalbedrag)
        item.totaalbedrag = parseFloat(item.totaalbedrag).toFixed(2)

      if(item.bedrag)
        item.bedrag = parseFloat(item.bedrag).toFixed(2)

      let verdeelsleutel = ""
      if(item.verdeling_teller){
        verdeelsleutel = item.verdeling_teller+"/"+item.verdeling_noemer
      }

      doc.fontSize(14)
      let lTotaalbedrag = doc.widthOfString(item.totaalbedrag)
      let lBedrag = doc.widthOfString(item.bedrag)
      let lVerdeelsleutel = doc.widthOfString(verdeelsleutel)

      if(item.type=='Totaal'||item.type=='Te betalen')
        doc.font('Helvetica-Bold')
      else
        doc.font('Helvetica')

      if(item.type=='Totaal')
        y=y+10

      if(item.type=='Te betalen'){
        if(item.bedrag<0) sign = "ontvangen"
      }

      doc.fontSize(14)
         .text(item.type,50,y)
         .text(item.totaalbedrag,280-lTotaalbedrag,y)
         .text(verdeelsleutel,440-lVerdeelsleutel,y)
         .text(item.bedrag,500-lBedrag,y)

      y=y+20
    }

    //get rekeningnummer gegevens + print
    const qRekeningnummer = "SELECT werkrekeningnummer FROM gebouwen WHERE id = $1"
    const rRekeningnummer = await pool.query(qRekeningnummer, [req.gebouw])

    let textRRN = "Gelieve dit bedrag te betalen binnen 14 dagen op rekeningnummer " + rRekeningnummer.rows[0].werkrekeningnummer
    if(sign=="ontvangen")
      textRRN = "We storten bovenstaand bedrag terug op uw rekening binnen 14 dagen"

    doc.font('Helvetica')
       .text(textRRN,50,y+40)

    doc.end()

    let mailText = 'Geachte '+rOwner.rows[0].naam+'\n\n'+
                   'Als bijlage vindt u de afrekening voor appartement '+unit.naam+
                   ' voor de periode van '+van+' tot '+tot+'.\n\n'

    //send mail
    let options = {
      from:'janhendrikblonde@gmail.com',
      to:rOwner.rows[0].email,
      subject:'Afrekening '+unit.naam,
      text:mailText,
      attachments: [
        {
          filename: 'afrekening.pdf',
          path: 'generatedpdfs/A'+req.query.afrekeningID+'_Unit'+unit.naam+'.pdf'
        }
      ]
    }

    transporter.sendMail(options, function(error,info){
      if(error){
        console.log(error);
      }else{
        console.log('Email sent: ' + info.response);
        res.status(200).send('OK');
      }
    })

  }

  res.status(200).send({'status':'OK'})

})

router.get('/afrekeningen', verifyToken, function(req,res){
  console.log('GET afrekeningen')

  const qAfrekeningen = "SELECT * FROM afrekeningen WHERE fk_gebouw=$1 ORDER BY id ASC"
  pool.query(qAfrekeningen, [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows);
                }
              })

})

router.get('/afrekeningdetails', verifyToken, function(req,res){
  console.log('GET afrekeningdetails')

  const qAfrekening = "SELECT * FROM afrekening_items WHERE fk_afrekening = $1"
  pool.query(qAfrekening, [req.query.id],(error, results)=>{
    if(error) console.log(error)
    else res.status(200).send(results.rows)
  })

})

router.get('/afrekening', verifyToken, function(req,res){
  const qAfrekening = "SELECT * FROM afrekeningen WHERE id=$1"
  pool.query(qAfrekening, [req.query.id],(error, results)=>{
    if(error) console.log(error)
    else res.status(200).send(results.rows[0])
  })

})

router.get('/latestafrekening', verifyToken, function(req,res){
  console.log('GET afrekeningen')

  const qAfrekeningen = "SELECT MAX(tot) AS maxdate FROM afrekeningen WHERE fk_gebouw=$1"
  pool.query(qAfrekeningen, [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows[0]);
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
    const result = await pool.query('SELECT werkrekeningnummer, reserverekeningnummer FROM gebouwen WHERE id = ($1)', [req.gebouw]);

    rekeningnummers = new Map();
    rekeningnummers.set(result.rows[0].werkrekeningnummer, 1);
    rekeningnummers.set(result.rows[0].reserverekeningnummer, 2);

    //get partners: fk's en types
    const p_result = await pool.query('SELECT id, fk_type, bankrnr FROM partners WHERE fk_gebouw = ($1)', [req.gebouw]);

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

          let rekeningnummer, datum, bedrag, omschrijving, tegenrekening = ""

          if(data.length==18){ //KBC
            console.log('KBC')
            rekeningnummer = data[0]
            datum = data[5]
            bedrag = data[8]
            omschrijving = data[6]
            tegenrekening = data[12]
          }else if(data.length==8){ //FORTIS
            console.log("FORTIS")
            rekeningnummer = data[7]
            datum = data[2]
            bedrag = data[3]
            omschrijving = data[6]
            tegenrekening = data[5]
          }else if(data.length==11){ //ING
            console.log("ING")
            rekeningnummer = data[0]
            datum = data[4]
            bedrag = data[6]
            if(data[9]==""){
              omschrijving = data[8]
            }else{
              omschrijving = data[9]
            }
            tegenrekening = data[2]
          }else{
            console.log('onbekend formaat')
          }

          if(rekeningnummers.has(rekeningnummer)){

            date= datum.substr(6,4)+'/'+datum.substr(3,2)+'/'+datum.substr(0,2);

            console.log(p_rekeningnummers.get(tegenrekening))
            console.log(p_types.get(tegenrekening))

            let queryString = 'INSERT INTO bankrekeninguittreksels (datum, bedrag, omschrijving, tegenrekening, bankrekening, fk_partner, fk_type, fk_gebouw, linked) '+
                              'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false) RETURNING id';
            const results = await pool.query(queryString,[date,
                                                          bedrag.replace(",","."),
                                                          omschrijving.substr(0,299),
                                                          tegenrekening,
                                                          rekeningnummer,
                                                          p_rekeningnummers.get(tegenrekening),
                                                          p_types.get(tegenrekening),
                                                          req.gebouw])

            //check of het over een verdeling volgens verbruik gaat
            //SELECT * FROM kosten_types WHERE id = id
            const verdeling_result = await pool.query('SELECT verdeling FROM kosten_types WHERE id=$1',[p_types.get(tegenrekening)])

            //check op verdeling = 'verbruik'
            if(verdeling_result.rows[0] && verdeling_result.rows[0].verdeling==='verbruik'){

              //check of er een niet-afgerekend verbruik bestaat voor dit kostentype
              const ve_check = await pool.query('SELECT * FROM verbruiken WHERE fk_gebouw = $1 AND afgerekend = false AND fk_kostentype=$2',
                                                [req.gebouw, p_types.get(tegenrekening)])

              if(!ve_check.rows[0]){

                //maak verbruiken aan
                console.log('create verbruiken')
                const ve_create = await pool.query('INSERT INTO verbruiken (afgerekend, fk_gebouw, fk_kostentype, datum, fk_partner) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                                                                            ['false', req.gebouw, p_types.get(tegenrekening), date, p_rekeningnummers.get(tegenrekening)])

                //loop over units
                const units_result = await pool.query('SELECT * FROM units WHERE fk_gebouw = $1', [req.gebouw])

                for(let element of units_result.rows){
                  await pool.query('INSERT INTO verbruik_items (verbruik_fk, unit_fk, verbruikt) VALUES ($1, $2, $3)',
                                                                [ve_create.rows[0].id, element.id, 0])
                }
              }
            }

            //check of dit een factuur betaald
            let fk_partner = p_rekeningnummers.get(tegenrekening);
            let betaald_bedrag = parseFloat(bedrag.replace(",","."));

            const f_result = await pool.query('SELECT id, bedrag, fk_partner FROM facturen WHERE betaald = false AND fk_partner = $1 AND fk_gebouw = $2 ORDER BY datum', [fk_partner, req.gebouw]);

            let match = false
            let doublematch = false

            //loop over openstaande facturen voor deze leverancier
            for(let element of f_result.rows){
              if(parseFloat(element.bedrag)==-betaald_bedrag){
                console.log('match')
                const results2 = await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[results.rows[0].id,element.id]);
                const results3 = await pool.query('UPDATE facturen SET betaald = true WHERE id=$1', [element.id]);
                const results4 = await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [results.rows[0].id]);
                match = true
                break;
              }
            }

            if(!match){
              // loop over openstaande facturen en combineer met andere openstaande factuur
              for(let element of f_result.rows){
                if(!doublematch){
                  for(let element2 of f_result.rows){
                    if((parseFloat(element.bedrag)+parseFloat(element2.bedrag)==-betaald_bedrag)&&(element.id!==element2.id)){
                      console.log('double match')
                      await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[results.rows[0].id,element.id]);
                      await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[results.rows[0].id,element2.id]);
                      await pool.query('UPDATE facturen SET betaald = true WHERE id=$1', [element.id]);
                      await pool.query('UPDATE facturen SET betaald = true WHERE id=$1', [element2.id]);
                      await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [results.rows[0].id]);
                      doublematch = true
                      break;
                    }
                  }
                }
              }
            }

            if(!match&&!doublematch){
              //loop over niet gelinkte rekeninguittreksels en check of de combinatie met dit rekeninguittreksel een factuur betaald
              const f_result2 = await pool.query('SELECT id, bedrag, fk_partner FROM bankrekeninguittreksels WHERE linked = false AND fk_partner = $1 AND fk_gebouw = $2 AND id != $3 ORDER BY datum', [fk_partner, req.gebouw, results.rows[0].id]);

              for(let element of f_result.rows){ //facturen
                for(let element2 of f_result2.rows){ //uittreksels
                  if(betaald_bedrag+parseFloat(element2.bedrag)==-parseFloat(element.bedrag)){
                    console.log('triple match') //dit uitreksel + ander uittreksel betaald een factuur
                    await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[results.rows[0].id,element.id]);
                    await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[element2.id,element.id]);
                    await pool.query('UPDATE facturen SET betaald = true WHERE id=$1', [element.id]);
                    await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [results.rows[0].id]);
                    await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element2.id]);
                    break;
                  }
                }
              }
            }

            //TODO: check of dit een voorschot betaald
            const v_result = await pool.query('SELECT id, bedrag, fk_partner FROM voorschotten WHERE betaald = false AND fk_partner = $1 AND fk_gebouw = $2 ORDER BY datum', [fk_partner, req.gebouw]);

            let v_match = false
            let v_doublematch = false

            //loop over openstaande voorschotten voor deze eigendaar
            for(let element of v_result.rows){
              if(parseFloat(element.bedrag)==betaald_bedrag){
                console.log('voorschot match')
                await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[results.rows[0].id,element.id]);
                await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1', [element.id]);
                await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [results.rows[0].id]);
                v_match = true
                break;
              }
            }

            if(!v_match){
              // loop over openstaande voorschotten en combineer met andere openstaande voorschot
              for(let element of v_result.rows){
                if(!doublematch){
                  for(let element2 of v_result.rows){
                    if((parseFloat(element.bedrag)+parseFloat(element2.bedrag)==betaald_bedrag)&&(element.id!==element2.id)){
                      console.log('double match')
                      await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[results.rows[0].id,element.id]);
                      await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[results.rows[0].id,element2.id]);
                      await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1', [element.id]);
                      await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1', [element2.id]);
                      await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [results.rows[0].id]);
                      doublematch = true
                      break;
                    }
                  }
                }
              }
            }

            if(!match&&!doublematch){
              //loop over niet gelinkte rekeninguittreksels en check of de combinatie met dit rekeninguittreksel een voorschot betaald
              const v_result2 = await pool.query('SELECT id, bedrag, fk_partner FROM bankrekeninguittreksels WHERE linked = false AND fk_partner = $1 AND fk_gebouw = $2 AND id != $3 ORDER BY datum', [fk_partner, req.gebouw, results.rows[0].id]);

              for(let element of v_result.rows){ //voorschotten
                for(let element2 of v_result2.rows){ //uittreksels
                  if(betaald_bedrag+parseFloat(element2.bedrag)==parseFloat(element.bedrag)){
                    console.log('triple match') //dit uitreksel + ander uittreksel betaald een factuur
                    await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[results.rows[0].id,element.id]);
                    await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[element2.id,element.id]);
                    await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1', [element.id]);
                    await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [results.rows[0].id]);
                    await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1', [element2.id]);
                    break;
                  }
                }
              }
            }
          }
        }
        fs.unlinkSync(req.file.path);
        return res.sendStatus(200);
      });

});

module.exports = router;
