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
  database: 'api',
  password: config.dbpassword,
  port: config.dbport,
})

//---EMAIL---

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.mailuser,
    pass: config.mailpassword
  }
});

const mailOptions = {
  from: 'janhendrikblonde@gmail.com',
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

router.post('/mail',(req,res)=>{

  let options = {
    from:'',
    to:'',
    subject:'',
    text:''
  }

  if(req.body)
    options = req.body

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

    await pool.query('INSERT INTO kosten_types (naam, fk_gebouw) VALUES ($1,$2)', ['electriciteit',resultsGebouwen.rows[0].id]);
    await pool.query('INSERT INTO kosten_types (naam, fk_gebouw) VALUES ($1,$2)', ['schoonmaak',resultsGebouwen.rows[0].id]);
    await pool.query('INSERT INTO kosten_types (naam, fk_gebouw) VALUES ($1,$2)', ['verwarming',resultsGebouwen.rows[0].id]);
    await pool.query('INSERT INTO kosten_types (naam, fk_gebouw) VALUES ($1,$2)', ['waterverbruik',resultsGebouwen.rows[0].id]);
    await pool.query('INSERT INTO kosten_types (naam, fk_gebouw) VALUES ($1,$2)', ['herstelling en onderhoud',resultsGebouwen.rows[0].id]);
    await pool.query('INSERT INTO kosten_types (naam, fk_gebouw) VALUES ($1,$2)', ['administratie',resultsGebouwen.rows[0].id]);

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

  pool.query('INSERT INTO units (naam, duizendste, fk_gebouw) VALUES ($1, $2, $3) RETURNING id',
                [req.body.naam, req.body.duizendste, req.gebouw], (error, results) => {
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

  pool.query('SELECT id, naam, duizendste from units WHERE id = $1', [req.query.id], (error, results) => {
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
                    createEigendom(req, res, results.rows[0].id, req.body.unitFK);
                  }
                })
})

function createEigendom(req, res, eigenaarId, unitId) {

  pool.query('INSERT INTO eigendom (eigenaar, unit) VALUES ($1, $2) RETURNING id',
                [eigenaarId, unitId], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send({id:eigenaarId});
                  }
                })

}

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

  let queryString = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type, bu.fk_factuur as factuur FROM bankrekeninguittreksels as bu " +
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
  pool.query("SELECT id, naam from kosten_types WHERE fk_gebouw = $1 and id>1",
              [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results);
                }
              })
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

  let queryString = "SELECT fa.id, fa.bedrag, pa.naam as partner, fa.omschrijving, fa.datum, fa.vervaldatum, fk_uittreksel "+
                    "FROM facturen as fa "+
                    "LEFT OUTER JOIN partners AS pa ON fa.fk_partner = pa.id "+
                    "WHERE fa.fk_gebouw = $1 and fa.type='leverancier' ORDER BY fa.datum";
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

  let queryString = "SELECT fa.id, fa.bedrag, pa.naam as partner, fa.omschrijving, fa.datum, fa.vervaldatum, fk_uittreksel "+
                    "FROM facturen as fa "+
                    "LEFT OUTER JOIN partners AS pa ON fa.fk_partner = pa.id "+
                    "WHERE fa.fk_gebouw = $1 and fa.type='leverancier' and fk_uittreksel is Null ORDER BY fa.datum";
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

  let queryString = "SELECT fa.id, fa.bedrag, pa.naam as partner, fa.fk_partner, fa.omschrijving, fa.datum, fa.vervaldatum, fa.fk_uittreksel, fa.type " +
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
  console.log('facturen');

  let queryString = "SELECT fa.id, fa.bedrag, pa.naam as partner, fa.omschrijving, fa.datum, fa.vervaldatum, fa.fk_uittreksel "+
                    "FROM facturen as fa "+
                    "LEFT OUTER JOIN partners AS pa ON fa.fk_partner = pa.id "+
                    "WHERE fa.fk_gebouw = $1 and fa.type='voorschot' ORDER BY fa.datum";
  pool.query(queryString, [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows);
                }
              })
})

router.get('/openvoorschotten', verifyToken, (req,res) => {
  console.log('facturen');

  let queryString = "SELECT fa.id, fa.bedrag, pa.naam as partner, fa.omschrijving, fa.datum, fa.vervaldatum, fa.fk_uittreksel "+
                    "FROM facturen as fa "+
                    "LEFT OUTER JOIN partners AS pa ON fa.fk_partner = pa.id "+
                    "WHERE fa.fk_gebouw = $1 and fa.type='voorschot' and fa.fk_uittreksel is Null ORDER BY fa.datum";
  pool.query(queryString, [req.gebouw], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows);
                }
              })
})

router.post('/voorschotten', verifyToken, async function (req,res){

  factuurID = null;

  const results1 = await pool.query("INSERT INTO facturen (bedrag, omschrijving, datum, vervaldatum, fk_partner, fk_gebouw, type) VALUES ($1, $2, $3, $4, $5, $6, 'voorschot') RETURNING id",
                [req.body.bedrag, req.body.omschrijving, req.body.datum, req.body.vervaldatum, req.body.fk_partner, req.gebouw]);

  factuurID = results1.rows[0].id;

  const results2 = await pool.query("SELECT id FROM bankrekeninguittreksels WHERE fk_factuur IS NULL and fk_partner = $1 and bedrag = $2",
              [req.body.fk_partner, req.body.bedrag]);

  if(results2.rows[0]){

    const results3 = await pool.query("UPDATE facturen SET fk_uittreksel = $1 WHERE id = $2",
              [results2.rows[0].id, factuurID]);

    const results4 = await pool.query("UPDATE bankrekeninguittreksels SET fk_factuur = $1 WHERE id = $2",
              [factuurID, results2.rows[0].id]);
  }

  res.status(200).send(results2);

})

router.post('/facturen', verifyToken, async function (req,res){

  factuurID = null;

  const results1 = await pool.query("INSERT INTO facturen (bedrag, omschrijving, datum, vervaldatum, fk_partner, fk_gebouw, type) VALUES ($1, $2, $3, $4, $5, $6, 'leverancier') RETURNING id",
                [req.body.bedrag, req.body.omschrijving, req.body.datum, req.body.vervaldatum, req.body.fk_partner, req.gebouw]);

  factuurID = results1.rows[0].id;

  const results2 = await pool.query("SELECT id FROM bankrekeninguittreksels WHERE fk_factuur IS NULL and fk_partner = $1 and bedrag = $2 AND fk_gebouw=$3",
              [req.body.fk_partner, req.body.bedrag, req.gebouw]);

  if(results2.rows[0]){

    const results3 = await pool.query("UPDATE facturen SET fk_uittreksel = $1 WHERE id = $2",
              [results2.rows[0].id, factuurID]);

    const results4 = await pool.query("UPDATE bankrekeninguittreksels SET fk_factuur = $1 WHERE id = $2",
              [factuurID, results2.rows[0].id]);
  }

  res.status(200).send(results2);

})

router.put('/facturen', verifyToken, (req, res) =>{
  console.log('put facturen')

  let queryString = "UPDATE facturen SET bedrag=$1, fk_partner=$2, omschrijving=$3, datum=$4, vervaldatum=$5 " +
                    "WHERE id=$6"

  pool.query(queryString, [req.body.bedrag, req.body.fk_partner, req.body.omschrijving,
                            req.body.datum, req.body.vervaldatum, req.body.id], (error, results) =>{
                              if(error){
                                console.log(error)
                              }else{
                                res.status(200).send(results);
                              }
                            })
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

router.put('/instellingen', verifyToken, (req, res) => {

  const queryString = "UPDATE gebouwen SET adres=$1, periodiciteit_voorschot=$2, dag_voorschot=$3, " +
                      "kosten=$4, nieuw=$5, overnamedatum=$6, werkrekeningnummer=$7, overgenomen_werkrekening=$8, reserverekeningnummer=$9, " +
                      "overgenomen_reserverekening=$10 WHERE id=$11"

  pool.query(queryString, [req.body.adres, req.body.periodiciteit, req.body.voorschotdag,
                            req.body.kosten, req.body.nieuw, req.body.overnamedatum, req.body.werkrekeningnummer,
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

    if(!results.rows[0].nieuw){
      if(results.rows[0].overgenomen_werkrekening == 0  && results.rows[0].overgenomen_reserverekening == 0) instellingenFilled = false
      if(results.rows[0].overnamedatum == '') instellingenFilled = false
    }

  }

  //check units en duizendsten
  let unitsFilled = true;

  let queryUnits = "SELECT SUM(duizendste), COUNT(*) FROM units WHERE fk_gebouw = $1"

  const resultUnits = await pool.query(queryUnits, [req.gebouw]);

  if(!resultUnits.rows[0] || !resultUnits.rows[0].sum){
    unitsFilled = false
  }else{
    //console.log(resultUnits.rows[0])
    if(resultUnits.rows[0].sum!=1000) unitsFilled = false
  }

  //eigenaars
  let eigenaarsFilled = true

  let queryEigenaars = "SELECT * FROM partners WHERE fk_gebouw = $1 AND fk_type = 1"

  const resultEigenaars = await pool.query(queryEigenaars, [req.gebouw]);

  //console.log(resultEigenaars.rows)

  if(!resultEigenaars.rows || resultEigenaars.rows.length==0){
    eigenaarsFilled = false
  }else {
    let eigenaarsCount = 0;
    for(let element of resultEigenaars.rows){
      eigenaarsCount++
      if(!element.naam || element.naam =='') eigenaarsFilled = false
      if(!element.bankrnr || element.bankrnr=='') eigenaarsFilled = false

      //console.log(element)
    }
    if (!resultUnits.rows[0] || !resultUnits.rows[0].count || eigenaarsCount<resultUnits.rows[0].count)
      eigenaarsFilled = false
  }

  console.log(instellingenFilled)
  console.log(unitsFilled)
  console.log(eigenaarsFilled)

  if(instellingenFilled&&unitsFilled&&eigenaarsFilled){
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
    rapport.set(element.naam,{'voorschotten':0,'uitgaven':0,'saldo':0,'vorig_saldo':0 || parseInt(element.overgenomen_saldo_werk),
                              'totaal':0,'verdeelsleutel':0});
  };

  //set verdeelsleuten voor elke eigenaar
  let queryString = "SELECT units.id as id, units.naam as naam, units.duizendste as duizendste,"+
                    "partners.naam as eigenaar, partners.id as eigenaarid from units " +
                    "LEFT OUTER JOIN eigendom ON units.id = eigendom.unit " +
                    "LEFT OUTER JOIN partners ON eigendom.eigenaar = partners.id " +
                    "WHERE units.fk_gebouw = $1 ORDER BY units.naam";

  const result2 = await pool.query(queryString, [req.gebouw]);

  for(let element of result2.rows){
    let myObj = rapport.get(element.eigenaar);
    myObj.verdeelsleutel = myObj.verdeelsleutel + element.duizendste
    rapport.set(element.eigenaar,myObj);
  };

  let queryBankrekeningnr = "SELECT werkrekeningnummer "+
                            "FROM gebouwen WHERE id=$1";

  const resultsBankrekeningnr = await pool.query(queryBankrekeningnr, [req.gebouw])

  //voorschotten en kosten
  let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type, bu.fk_factuur as factuur FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
                    "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
                    "WHERE bu.bankrekening = ($1);"

  const result3 = await pool.query(queryString2, [resultsBankrekeningnr.rows[0].werkrekeningnummer]);

  for(let element of result3.rows){
    //voorschotten
    if(rapport.get(element.tegenpartij)&&element.type=='voorschot'){
      let myObj = rapport.get(element.tegenpartij);
      myObj.voorschotten = myObj.voorschotten+parseInt(element.bedrag)
      rapport.set(element.tegenpartij,myObj)
    //kosten
    }else{
      //toekennen aan iedere eigenaar
      rapport.forEach(function(value,key){
        let verdeling = (element.bedrag*value.verdeelsleutel)/1000;
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
  let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type, bu.fk_factuur as factuur FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
                    "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
                    "WHERE bu.bankrekening = ($1);"

  const result2 = await pool.query(queryString2, [resBankrekeningnr.rows[0].werkrekeningnummer]);

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
      myObj[month] = parseInt(myObj[month]) + parseInt(element.bedrag.toString());
      myObj[12] = myObj[12] + parseInt(element.bedrag.toString());

      rapport.set(element.tegenpartij,myObj);

      if(month==0) t0=t0+parseInt(element.bedrag.toString())
      else if(month==1) t1=t1+parseInt(element.bedrag.toString())
      else if(month==2) t2=t2+parseInt(element.bedrag.toString())
      else if(month==3) t3=t3+parseInt(element.bedrag.toString())
      else if(month==4) t4=t4+parseInt(element.bedrag.toString())
      else if(month==5) t5=t5+parseInt(element.bedrag.toString())
      else if(month==6) t6=t6+parseInt(element.bedrag.toString())
      else if(month==7) t7=t7+parseInt(element.bedrag.toString())
      else if(month==8) t8=t8+parseInt(element.bedrag.toString())
      else if(month==9) t9=t9+parseInt(element.bedrag.toString())
      else if(month==10) t10=t10+parseInt(element.bedrag.toString())
      else if(month==11) t11=t11+parseInt(element.bedrag.toString())

      t12 = t12 + parseInt(element.bedrag.toString())

    }
  }

  rapport.set('Totaal',{'0':t0,'1':t1,'2':t2,'3':t3,'4':t4,'5':t5,
                            '6':t6,'7':t7,'8':t8,'9':t9,'10':t10,'11':t11,'12':t12})

  console.log(rapport);
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
  let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type, bu.fk_factuur as factuur FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
                    "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
                    "WHERE bu.bankrekening = ($1);"

  const result2 = await pool.query(queryString2, [resBankrekeningnr.rows[0].werkrekeningnummer]);

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
      myObj[month] = parseInt(myObj[month]) + parseInt(element.bedrag.toString());
      myObj[12] = myObj[12] + parseInt(element.bedrag.toString());

      rapport.set(element.tegenpartij,myObj);

      if(month==0) t0=t0+parseInt(element.bedrag.toString())
      else if(month==1) t1=t1+parseInt(element.bedrag.toString())
      else if(month==2) t2=t2+parseInt(element.bedrag.toString())
      else if(month==3) t3=t3+parseInt(element.bedrag.toString())
      else if(month==4) t4=t4+parseInt(element.bedrag.toString())
      else if(month==5) t5=t5+parseInt(element.bedrag.toString())
      else if(month==6) t6=t6+parseInt(element.bedrag.toString())
      else if(month==7) t7=t7+parseInt(element.bedrag.toString())
      else if(month==8) t8=t8+parseInt(element.bedrag.toString())
      else if(month==9) t9=t9+parseInt(element.bedrag.toString())
      else if(month==10) t10=t10+parseInt(element.bedrag.toString())
      else if(month==11) t11=t11+parseInt(element.bedrag.toString())

      t12 = t12 + parseInt(element.bedrag.toString())
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
  let queryString = "SELECT facturen.id, facturen.bedrag, partners.naam FROM facturen "+
                    "LEFT OUTER JOIN partners ON facturen.fk_partner = partners.id "+
                    "WHERE facturen.fk_gebouw = $1 AND facturen.type='voorschot' AND facturen.fk_uittreksel IS NULL";

  const result = await pool.query(queryString, [req.gebouw]);

  let vorderingenTotaal = 0
  rapport.vorderingen_detail = []

  for (let element of result.rows){
    rapport.vorderingen_detail.push({'naam':element.naam,'bedrag':element.bedrag});
    vorderingenTotaal = vorderingenTotaal + parseInt(element.bedrag);
  }

  rapport.vorderingen = vorderingenTotaal;

  let queryOvergenomen = "SELECT werkrekeningnummer, overgenomen_werkrekening "+
                          "FROM gebouwen WHERE id=$1";

  const resOvergenomen = await pool.query(queryOvergenomen, [req.gebouw])
  console.log(resOvergenomen)

  //bankrekening
  let queryString2 = "SELECT SUM(bedrag) as som FROM bankrekeninguittreksels "+
                    "WHERE bankrekening = $1";

  const result2 = await pool.query(queryString2, [resOvergenomen.rows[0].werkrekeningnummer]);

  rapport.bank = parseFloat(result2.rows[0].som.toString()) + parseFloat(resOvergenomen.rows[0].overgenomen_werkrekening.toString());

  //openstaande leveranciers
  let queryString3 = "SELECT facturen.id, facturen.bedrag, partners.naam FROM facturen "+
                    "LEFT OUTER JOIN partners ON facturen.fk_partner = partners.id "+
                    "WHERE facturen.fk_gebouw = $1 AND facturen.type='leverancier' AND facturen.fk_uittreksel IS NULL";

  const result3 = await pool.query(queryString3, [req.gebouw]);

  let leveranciersTotaal = 0
  rapport.leveranciers_detail = []

  for (let element of result3.rows){
    rapport.leveranciers_detail.push({'naam':element.naam,'bedrag':-element.bedrag});
    leveranciersTotaal = leveranciersTotaal + parseInt(element.bedrag);
  }

  rapport.leveranciers = -leveranciersTotaal;

  rapport.teveelvoorschotten = parseInt(rapport.bank) + parseInt(rapport.vorderingen) - parseInt(rapport.leveranciers)

  rapport.totaal_activa = parseInt(rapport.bank) + parseInt(rapport.vorderingen)

  rapport.totaal_passiva = parseInt(rapport.leveranciers) + parseInt(rapport.teveelvoorschotten)

  console.log(rapport)

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
                      "WHERE bankrekening = $1 AND  bedrag > 0 "+
                      "GROUP BY date_trunc( 'month', datum ) ORDER BY date_trunc( 'month', datum );"

  const results = await pool.query(queryString, [resultsBankrekeningnr.rows[0].werkrekeningnummer])

  res.status(200).send(results)

})

router.get('/uitgaven', verifyToken, async function(req,res){

  let queryBankrekeningnr = "SELECT werkrekeningnummer "+
                            "FROM gebouwen WHERE id=$1";

  const resultsBankrekeningnr = await pool.query(queryBankrekeningnr, [req.gebouw])

  const queryString = "SELECT date_trunc( 'month', datum ), SUM(bedrag) "+
                      "FROM bankrekeninguittreksels "+
                      "WHERE bankrekening = $1 AND  bedrag < 0 "+
                      "GROUP BY date_trunc( 'month', datum ) ORDER BY date_trunc( 'month', datum );"

  const results = await pool.query(queryString, [resultsBankrekeningnr.rows[0].werkrekeningnummer])

  res.status(200).send(results)

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

    // if(result.rows){
    //   result.rows.forEach((element)=>{
    //     rekeningnummers.set(element.rekeningnummer,element.id);
    //   })
    // }

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

          if(rekeningnummers.has(data[0])){

            date= data[5].substr(6,4)+'/'+data[5].substr(3,2)+'/'+data[5].substr(0,2);

            let queryString = 'INSERT INTO bankrekeninguittreksels (datum, bedrag, omschrijving, tegenrekening, bankrekening, fk_partner, fk_type, fk_factuur, fk_gebouw) '+
                              'VALUES ($1, $2, $3, $4, $5, $6, $7, Null, $8) RETURNING id';
            const results = await pool.query(queryString,[date,
                                                          data[8].replace(",","."),
                                                          data[6].substr(0,299),
                                                          data[12],
                                                          data[0],
                                                          p_rekeningnummers.get(data[12]),
                                                          p_types.get(data[12]),
                                                          req.gebouw])


            //TODO: check of dit een factuur betaald
            const f_result = await pool.query('SELECT id, bedrag, fk_partner FROM facturen where fk_uittreksel IS NULL and fk_gebouw = $1 ORDER BY datum', [req.gebouw]);
            console.log(f_result.rows);

            for(let element of f_result.rows){
              // console.log(data[8].replace(",","."))
              // console.log(p_rekeningnummers.get(data[12]))
              // console.log(results.rows[0].id)
              // console.log(element.id)
              if(parseInt(element.bedrag)==parseInt(data[8].replace(",","."))&&element.fk_partner===p_rekeningnummers.get(data[12])){
                console.log('match')
                const results2 = await pool.query('UPDATE bankrekeninguittreksels SET fk_factuur=$1 WHERE id=$2',[element.id,results.rows[0].id]);
                const results3 = await pool.query('UPDATE facturen SET fk_uittreksel = $1 WHERE id=$2', [results.rows[0].id,element.id]);
                break;
              }
            }
          }
        }
        fs.unlinkSync(req.file.path);
        return res.sendStatus(200);
      });

});

module.exports = router;
