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

//DATABASE SETUP

const Pool = require('pg').Pool

const pool = new Pool({
  user: config.dbuser,
  host: config.dbhost,
  database: config.database,
  password: config.dbpassword,
  port: config.dbport,
})

//EMAIL SETUP

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
      res.status(200).send({'status':'OK'});
    }
  })
})

router.post('/register', async function (req, res){
  let userData = req.body
  let user = new User(userData);
  console.log('register');

  let resultsExisting = await pool.query('SELECT * FROM users WHERE email = $1',[user.email])

  if(resultsExisting.rows[0]){

    res.status(400).send({'message':'Een account met dit e-mail adres bestaat al'})

  }else{

    let resultsGebouwen = await pool.query('INSERT INTO gebouwen (overgenomen_werkrekening, overgenomen_reserverekening) VALUES (0, 0) RETURNING id')

    let results = await pool.query("INSERT INTO users (email, password, fk_gebouw, role) VALUES ($1, $2, $3, 'nimda') RETURNING id",
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
  console.log('POST login')
  let userData = req.body

  pool.query('SELECT * FROM users WHERE UPPER(email) = UPPER($1)', [userData.email], (error, results) => {
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

router.post('/role', (req, res) =>{
  console.log('POST role')
  let userData = req.body

  pool.query('SELECT role FROM users WHERE email = $1', [userData.email], (error, results) =>{
    if(error){
      console.log(error)
    }else{
      res.status(200).send(results)
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
          text:'Beste, via volgende link kan je een nieuw paswoord ingeven: https://sndx.be/ngApp/passwordreset?code='+OTP,
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

router.post('/invite', verifyToken, (req,res) => {
  console.log('POST invite')

  let digits = '0123456789aBcdEfGHIj';
  let OTP = '';
  for (let i = 0; i < 12; i++ ) {
      OTP += digits[Math.floor(Math.random() * 20)];
  }

  let queryString = "INSERT INTO users (email, password, fk_gebouw, reset, role) " +
                    "VALUES ($1, $2, $3, $4, 'reader') RETURNING id";

  pool.query(queryString, [req.body.email, 'ranDomShizzle64332_;', req.gebouw, OTP], (error, results) =>{
    if(error){
       let updateString = "UPDATE users SET reset = $1 WHERE email = $2"
       pool.query(updateString, [OTP, req.body.email], (error, results) => {
         if(error){
           console.log(error)
         }else{
           let emailText = "Beste, \n\n" +
                           "Er is een nieuw account voor u aangemaakt om de gegevens van de VME te kunnen raadplegen.\n\n" +
                           "Eerst dient u via volgende link een nieuw paswoord in te geven: https://sndx.be/ngApp/passwordreset?code="+OTP + "\n\n" +
                           "Daarna kan u via https://sndx.be/ngApp/login inloggen op de website, met als E-mail: " + req.body.email + "\n\n" +
                           "en als paswoord het door u ingegeven paswoord."

           //send mail
           let content={
             from:'info@sndx.be',
             to:req.body.email,
             subject:'Uw nieuw account op SNDX.be',
             text:emailText
           }

           transporter.sendMail(content, function(error,info){
             if(error){
               console.log(error);
             }else{
               console.log('Email sent: ' + info.response);
               res.status(200).send({message:'email verzonden'});
             }})

         }
       })
    }else{

        let emailText = "Beste, \n\n" +
                        "Er is een nieuw account voor u aangemaakt om de gegevens van de VME te kunnen raadplegen.\n\n" +
                        "Eerst dient u via volgende link een nieuw paswoord in te geven: https://sndx.be/ngApp/passwordreset?code="+OTP + "\n\n" +
                        "Daarna kan u via https://sndx.be/ngApp/login inloggen op de website, met als E-mail: " + req.body.email + "\n\n" +
                        "en als paswoord het door u ingegeven paswoord."

        //send mail
        let content={
          from:'info@sndx.be',
          to:req.body.email,
          subject:'Uw nieuw account op SNDX.be',
          text:emailText
        }

        transporter.sendMail(content, function(error,info){
          if(error){
            console.log(error);
          }else{
            console.log('Email sent: ' + info.response);
            res.status(200).send({message:'email verzonden'});
          }})
    }
  })
})

router.post('/units', verifyToken, (req,res) => {
  console.log('post units');

  pool.query('INSERT INTO units (naam, type, duizendste, voorschot, saldo_afrekening, fk_gebouw) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
                [req.body.naam, req.body.type, req.body.duizendste, req.body.voorschot, req.body.saldo_afrekening, req.gebouw], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send(results);
                  }
                })
})

router.put('/units', verifyToken, (req,res) => {
  console.log('put units');

  pool.query("UPDATE units SET naam=$1, type=$2, duizendste=$3, voorschot= $4, saldo_afrekening=$5 WHERE id=$6 RETURNING id",
                [req.body.naam, req.body.type, req.body.duizendste, req.body.voorschot, req.body.saldo_afrekening, req.body.id], (error, results) => {
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

  pool.query('SELECT id, naam, type, duizendste, voorschot, saldo_afrekening from units WHERE id = $1', [req.query.id], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      res.status(200).send(results.rows[0]);
    }
  })

});


router.post('/eigenaars', verifyToken, (req, res) => {

  pool.query("INSERT INTO partners (naam, voornaam, bankrnr, bankrnr2, email, fk_type, fk_gebouw) VALUES ($1, $2, $3, $4, $5, 1, $6) RETURNING id",
                [req.body.naam, req.body.voornaam, req.body.bankrnr, req.body.bankrnr2,
                   req.body.email, req.gebouw], (error, results) => {
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

  pool.query('INSERT INTO eigendom (eigenaar, unit, fk_gebouw) VALUES ($1, $2, $3) RETURNING id',
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

  pool.query("UPDATE partners SET naam=$1, voornaam=$2, email=$3, bankrnr=$4, bankrnr2=$5  WHERE id=$6 RETURNING id",
                [req.body.naam, req.body.voornaam, req.body.email, req.body.bankrnr,
                   req.body.bankrnr2, req.body.id], (error, results) => {
                  if(error) {
                    console.log(error);
                  }else{
                    res.status(200).send(results);
                  }
                })
})

router.get('/eigenaar', verifyToken, (req, res) =>{
  console.log('get unit');

  let queryString = "SELECT id, naam, voornaam, email, bankrnr, bankrnr2 from partners WHERE id = $1"

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

  let queryString = 'SELECT id, naam, voornaam, email, bankrnr, bankrnr2 '+
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

  let queryString = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving FROM bankrekeninguittreksels as bu " +
                      "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
                      "WHERE bu.bankrekening= $1 AND bu.fk_gebouw=$2 ORDER BY bu.datum DESC;"

  const resultUittreksels = await pool.query(queryString, [rekeningnummer, req.gebouw]);

  res.status(200).send(resultUittreksels.rows)
})

router.get('/uittreksel', verifyToken, (req,res)=>{
  console.log('get uittreksel');

  let queryString = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, pa.naam as tegenpartij, bu.omschrijving FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN partners as pa on bu.fk_partner = pa.id " +
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


  pool.query("UPDATE bankrekeninguittreksels SET fk_partner=$1 WHERE tegenrekening=$2",
                [req.body.id, req.body.rekeningnummer], (error, results) => {
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


  pool.query("UPDATE bankrekeninguittreksels SET bedrag=$1 WHERE id=$2",
                [req.body.bedrag, req.body.id], (error, results) => {
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

  let queryString = "SELECT fa.id, fa.bedrag, pa.naam as partner, fa.omschrijving, fa.datum, fa.vervaldatum, fa.betaald, kt.naam AS type, fa.fk_type AS fk_type "+
                    "FROM facturen as fa "+
                    "LEFT OUTER JOIN kosten_types as kt ON fa.fk_type = kt.id " +
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

  let queryString = "SELECT fa.id, fa.bedrag, pa.naam as partner, fa.omschrijving, fa.datum, fa.vervaldatum, fa.betaald, kt.naam AS type, fa.fk_type AS fk_type "+
                    "FROM facturen as fa "+
                    "LEFT OUTER JOIN kosten_types as kt ON fa.fk_type = kt.id " +
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

  let queryString = "SELECT fa.id, fa.bedrag, pa.naam as partner, fa.fk_partner, fa.omschrijving, fa.datum, fa.vervaldatum, fa.betaald, kt.naam AS type, fa.fk_type AS fk_type " +
                    "FROM facturen as fa " +
                    "LEFT OUTER JOIN kosten_types as kt ON fa.fk_type = kt.id " +
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

router.get('/aanmanen', verifyToken, async function (req,res){
  console.log('aanmanen');

  let qVoorschot = "SELECT vo.bedrag, vo.vervaldatum, pa.naam AS eigenaar, pa.email, un.naam AS eigendom, un.type AS eigendomtype "+
                   "FROM voorschotten AS vo "+
                   "LEFT OUTER JOIN partners AS pa ON vo.fk_partner = pa.id "+
                   "LEFT OUTER JOIN units AS un ON vo.fk_unit = un.id " +
                   "WHERE vo.id= $1"
  let rVoorschot = await pool.query(qVoorschot,[req.query.id])

  let myDate = new Date(rVoorschot.rows[0].vervaldatum)
  let vDag = myDate.getDate()
  if(vDag.length==1)
    vDag = '0'+vDag
  let vMaand = myDate.getMonth()+1
  if(vMaand.length==1)
    vMaand = '0'+vMaand
  let vJaar = myDate.getFullYear()
  let vervaldatum = vDag + "/" + vMaand + "/" + vJaar

  let mailText = 'Beste ' + rVoorschot.rows[0].eigenaar + '\n\n'+
                 'Behoudens onze vergissing staat er nog een voorschot open voor een bedrag van ' + rVoorschot.rows[0].bedrag +
                 '€, met vervaldatum ' + vervaldatum + '.\n' +
                 'Gelieve dit bedrag binnen 7 dagen over te maken op rekeningnummer XYZ.'

  //send mail
  let options = {
    from:'info@sndx.be',
    to: rVoorschot.rows[0].email,
    subject:'Aanmaning voorschot ' + rVoorschot.rows[0].eigendomtype + ' ' + rVoorschot.rows[0].eigendom,
    text:mailText
  }

  transporter.sendMail(options, function(error,info){
    if(error){
      console.log(error);
    }else{
      console.log('Email sent: ' + info.response);
    }
  })

  let today = new Date();
  let dd = String(today.getDate()).padStart(2, '0');
  let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
  let yyyy = today.getFullYear();

  today = yyyy + '/' + mm + '/' + dd;

  let qInsertAanmaning = "UPDATE voorschotten SET aangemaand = $1 WHERE id = $2"
  let rInsertAanmaning = await pool.query(qInsertAanmaning, [today, req.query.id])

  res.status(200).send({'status':'OK'});
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

  let queryString = "SELECT vo.id, vo.bedrag, pa.naam as partner, vo.omschrijving, vo.datum, vo.vervaldatum, vo.betaald, vo.aangemaand "+
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

  //check datum
  let today = new Date()
  let day = String(today.getDate())
  let month = String(today.getMonth() + 1).padStart(2, '0');
  let year = String(today.getFullYear())

  //build description
  let description = ""
  let descriptionQ = ""

  switch (month) {
    case "01":
      description = "Voorschot januari";
      descriptionQ = "Voorschot eerste kwartaal"
      break;
    case "02":
      description = "Voorschot februari";
      break;
    case "03":
      description = "Voorschot maart";
      break;
    case "04":
      description = "Voorschot april";
      descriptionQ = "Voorschot tweede kwartaal"
      break;
    case "05":
      description = "Voorschot mei";
      break;
    case "06":
      description = "Voorschot juni";
      break;
    case "07":
      description = "Voorschot juli";
      descriptionQ = "Voorschot derde kwartaal"
      break;
    case "08":
      description = "Voorschot augustus";
      break;
    case "09":
      description = "Voorschot september";
      break;
    case "10":
      description = "Voorschot oktober";
      descriptionQ = "Voorschot vierde kwartaal"
      break;
    case "11":
      description = "Voorschot november";
      break;
    case "12":
      description = "Voorschot december";
    }

  //loop over gebouwen met maandelijkse afrekening
  const qGebouwen = "SELECT id FROM gebouwen " +
                    "WHERE setup_complete = true AND periodiciteit_voorschot = '1' AND dag_voorschot = $1"

  const rGebouwen = await pool.query(qGebouwen, [day])

  for(let gebouw of rGebouwen.rows){

    //get units for gebouw
    const qUnits = "SELECT un.voorschot, un.id, ei.eigenaar FROM units AS un " +
                   "LEFT OUTER JOIN eigendom as ei ON ei.unit = un.id " +
                   "WHERE un.fk_gebouw=$1"
    const rUnits = await pool.query(qUnits, [gebouw.id])

    for(let unit of rUnits.rows){
      createVoorschot(unit.voorschot, description, unit.eigenaar, unit.id, gebouw.id, req, res)
    }
  }

  if(month=='01'||month=='04'||month=='07'||month=='10'){

    //loop over gebouwen met driemaandelijkse afrekening
    qGebouwen = "SELECT id, overnamedatum FROM gebouwen " +
                "WHERE setup_complete = true AND periodiciteit_voorschot = '3' AND dag_voorschot = $1"

    rGebouwen = await pool.query(qGebouwen, [day])

    for(let gebouw of rGebouwen.rows){

      //get units for gebouw
      const qUnits = "SELECT un.voorschot, un.id, ei.eigenaar FROM units AS un " +
                     "LEFT OUTER JOIN eigendom as ei ON ei.unit = un.id " +
                     "WHERE un.fk_gebouw=$1"
      const rUnits = await pool.query(qUnits, [gebouw.id])

      for(let unit of rUnits.rows){
        createVoorschot(unit.voorschot, descriptionQ, unit.eigenaar, unit.id, gebouw.id, req, res)
      }
    }
  }

  res.status(200).send({'status':'OK'})
})

async function createVoorschot(bedrag, omschrijving, fk_partner, fk_unit, fk_gebouw, req, res) {

  let today = new Date();
  let dd = String(today.getDate()).padStart(2, '0');
  let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
  let yyyy = today.getFullYear();

  today = yyyy + '/' + mm + '/' + dd;

  let today14 = new Date(Date.now() + 12096e5);
  let dd14 = String(today14.getDate()).padStart(2, '0');
  let mm14 = String(today14.getMonth() + 1).padStart(2, '0'); //January is 0!
  let yyyy14 = today14.getFullYear();

  today14 = yyyy14 + '/' + mm14 + '/' + dd14;

  voorschotID = null;

  const results1 = await pool.query("INSERT INTO voorschotten (bedrag, omschrijving, datum, vervaldatum, fk_partner, fk_unit, fk_gebouw, type, betaald) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false ) RETURNING id",
                [bedrag, omschrijving, today, today14, fk_partner, fk_unit, fk_gebouw, 'voorschot']);

  voorschotID = results1.rows[0].id;

  voorschotMatch(0,req,res)

  //get eigenaar naam en mailadres
  const qEigenaar = "SELECT naam, email FROM partners WHERE id = $1"
  const rEigenaar = await pool.query(qEigenaar, [fk_partner])

  //get unit naam
  const qUnit = "SELECT naam, type FROM units WHERE id = $1"
  const rUnit = await pool.query(qUnit, [fk_unit])

  //get werkrekeningnummer van de VME
  const qGebouw = "SELECT werkrekeningnummer FROM gebouwen WHERE id = $1"
  const rGebouw = await pool.query(qGebouw, [fk_gebouw])

  let mailText = 'Geachte '+rEigenaar.rows[0].naam+'\n\n'+
                 'Gelieve het '+omschrijving +' van '+bedrag+' € voor ' + rUnit.rows[0].type + ' ' +rUnit.rows[0].naam+ ' ' +
                 'over te maken op het rekeningnummer '+rGebouw.rows[0].werkrekeningnummer+ ' van de VME.'

  //send mail
  let options = {
    from:'info@sndx.be',
    to:rEigenaar.rows[0].email,
    subject:omschrijving + ' ' + rUnit.rows[0].type + ' ' + rUnit.rows[0].naam,
    text:mailText,
    // attachments: [
    //   {
    //     filename: 'afrekening.pdf',
    //     path: 'generatedpdfs/A'+req.query.afrekeningID+'_Unit'+unit.naam+'.pdf'
    //   }
    // ]
  }

  transporter.sendMail(options, function(error,info){
    if(error){
      console.log(error);
    }else{
      console.log('Email sent: ' + info.response);
      res.status(200).send({'status':'OK'});
    }
  })

}

router.post('/voorschot', verifyToken, async function (req,res){

  voorschotID = null;

  const results1 = await pool.query("INSERT INTO voorschotten (bedrag, omschrijving, datum, vervaldatum, fk_partner, fk_unit, fk_gebouw, type, betaald) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false ) RETURNING id",
                [req.body.bedrag, req.body.omschrijving, req.body.datum, req.body.vervaldatum, req.body.fk_partner, req.body.fk_unit, req.gebouw, req.body.type]);

  voorschotID = results1.rows[0].id;

  voorschotMatch(0,req,res)

  res.status(200).send(results1);

})

router.post('/facturen', verifyToken, async function (req,res){

  factuurID = null;

  const results1 = await pool.query("INSERT INTO facturen (bedrag, omschrijving, datum, vervaldatum, fk_partner, fk_gebouw, betaald, fk_type) VALUES ($1, $2, $3, $4, $5, $6, false, $7) RETURNING id",
                [req.body.bedrag, req.body.omschrijving, req.body.datum, req.body.vervaldatum, req.body.fk_partner, req.gebouw, req.body.fk_type]);

  factuurID = results1.rows[0].id;

  //check of het over een verdeling volgens verbruik gaat
  //SELECT * FROM kosten_types WHERE id = id
  const verdeling_result = await pool.query('SELECT verdeling FROM kosten_types WHERE id=$1',[req.body.fk_type])

  //check op verdeling = 'verbruik'
  if(verdeling_result.rows[0] && verdeling_result.rows[0].verdeling==='verbruik'){

    //check of er een niet-afgerekend verbruik bestaat voor dit kostentype
    const ve_check = await pool.query('SELECT * FROM verbruiken WHERE fk_gebouw = $1 AND afgerekend = false AND fk_kostentype=$2',
                                      [req.gebouw, req.body.fk_type])

    if(!ve_check.rows[0]){

      //maak verbruiken aan
      console.log('create verbruiken')
      const ve_create = await pool.query('INSERT INTO verbruiken (afgerekend, fk_gebouw, fk_kostentype, datum, fk_partner) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                                                                  ['false', req.gebouw, req.body.fk_type, req.body.datum, req.body.fk_partner])

      //loop over units
      const units_result = await pool.query('SELECT * FROM units WHERE fk_gebouw = $1', [req.gebouw])

      for(let element of units_result.rows){
        await pool.query('INSERT INTO verbruik_items (verbruik_fk, unit_fk, verbruikt) VALUES ($1, $2, $3)',
                                                      [ve_create.rows[0].id, element.id, 0])
      }
    }
  }

  invoiceMatch(0,req,res)

  res.status(200).send(results1);

})

router.put('/facturen', verifyToken, async function (req, res) {
  console.log('put facturen')

  let queryString = "UPDATE facturen SET bedrag=$1, fk_partner=$2, omschrijving=$3, datum=$4, vervaldatum=$5, fk_type=$6 " +
                    "WHERE id=$7"

  await pool.query(queryString, [req.body.bedrag, req.body.fk_partner, req.body.omschrijving, req.body.datum, req.body.vervaldatum, req.body.fk_type, req.body.id])

  //check of het over een verdeling volgens verbruik gaat
  //SELECT * FROM kosten_types WHERE id = id
  const verdeling_result = await pool.query('SELECT verdeling FROM kosten_types WHERE id=$1',[req.body.fk_type])

  //check op verdeling = 'verbruik'
  if(verdeling_result.rows[0] && verdeling_result.rows[0].verdeling==='verbruik'){

    //check of er een niet-afgerekend verbruik bestaat voor dit kostentype
    const ve_check = await pool.query('SELECT * FROM verbruiken WHERE fk_gebouw = $1 AND afgerekend = false AND fk_kostentype=$2',
                                      [req.gebouw, req.body.fk_type])

    if(!ve_check.rows[0]){

      //maak verbruiken aan
      console.log('create verbruiken')
      const ve_create = await pool.query('INSERT INTO verbruiken (afgerekend, fk_gebouw, fk_kostentype, datum, fk_partner) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                                                                  ['false', req.gebouw, req.body.fk_type, req.body.datum, req.body.fk_partner])

      //loop over units
      const units_result = await pool.query('SELECT * FROM units WHERE fk_gebouw = $1', [req.gebouw])

      for(let element of units_result.rows){
        await pool.query('INSERT INTO verbruik_items (verbruik_fk, unit_fk, verbruikt) VALUES ($1, $2, $3)',
                                                      [ve_create.rows[0].id, element.id, 0])
      }
    }
  }

  //TODO: wat als het kostentype van 'verbruik' naar een ander type gaat?

  invoiceMatch(0,req,res)

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

router.get('/leverancier', verifyToken, (req,res) => {
  console.log('leverancier');
  pool.query("SELECT * FROM partners WHERE id = $1;",
              [req.query.id], (error, results) => {
                if(error){
                  console.log(error);
                }else{
                  res.status(200).send(results.rows);
                }
              })
})

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

  let queryString = "SELECT * FROM gebouwen WHERE id = $1";

  const results = await pool.query(queryString, [req.gebouw]);

  if(results.rows[0]&&results.rows[0].setup_complete){
    console.log('complete based on db')
    res.status(200).send({'setup':3});
  }else{

  //check instellingen
  let instellingenFilled = true;

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

    //kosten_types
    let kostentypesFilled = true

    let queryKostentypes = "SELECT * FROM kosten_types WHERE fk_gebouw= $1"

    const resultKostentypes = await pool.query(queryKostentypes, [req.gebouw]);

    for(let element of resultKostentypes.rows){
      //console.log(element.verdeling)
      if(!element.verdeling){
        kostentypesFilled = false
      }
    }

    //facturen
    // let facturenFilled = false
    //
    // let qNieuw  = "SELECT nieuw FROM gebouwen where id=$1"
    // const rNieuw = await pool.query(qNieuw, [req.gebouw])
    // //console.log(rNieuw.rows)
    //
    // if(rNieuw.rows[0].nieuw){
    //   facturenFilled = true
    // }else{
    //   let qCountFacturen = "SELECT COUNT(*) FROM facturen where fk_gebouw=$1"
    //   const rCountFacturen = await pool.query(qCountFacturen, [req.gebouw])
    //   //console.log(rCountFacturen.rows)
    //   if(rCountFacturen.rows[0].count > 0)
    //     facturenFilled = true
    // }

    let status = -1
    if(instellingenFilled) status = 0
    if(unitsFilled&&eigenaarsFilled) status = 1
    if(kostentypesFilled) status = 2
    //if(facturenFilled) status = 3

    console.log(status)

    res.status(200).send({'setup':status})

    // if(instellingenFilled&&unitsFilled&&eigenaarsFilled&&kostentypesFilled&&facturenFilled){
    //   res.status(200).send({'setup':'true'});
    // }else{
    //   if(kostentypesFilled){
    //     res.status(200).send({'setup':'kostentypes'})
    //   }else if(eigenaarsFilled){
    //     res.status(200).send({'setup':'eigenaars'});
    //   }else if(unitsFilled){
    //     res.status(200).send({'setup':'units'});
    //   }else if(instellingenFilled){
    //     res.status(200).send({'setup':'instellingen'});
    //   }else{
    //     res.status(200).send({'setup':'false'})
    //   }
    // }
  }
})

router.get('/voltooisetup', verifyToken, async function (req, res){
  console.log('voltooi setup')

  let qVoltooi = "UPDATE gebouwen SET setup_complete = true WHERE id = $1"
  const rVoltooi = await pool.query(qVoltooi, [req.gebouw])

  res.status(200).send({'status':'OK'})
})


// //rapporten
// router.get('/werkrekeningrapport', verifyToken, async function(req, res) {
//   console.log('werkrekeningrapport');
//
//   let rapport = new Map();
//
//   const result = await pool.query('SELECT id, naam, voornaam, email, bankrnr, overgenomen_saldo_werk '+
//                                   'FROM partners WHERE fk_gebouw = $1 AND fk_type=1', [req.gebouw]);
//
//   for(let element of result.rows){
//     rapport.set(element.naam,{'voorschotten':0,'uitgaven':0,'saldo':0,'vorig_saldo':0 || parseFloat(element.overgenomen_saldo_werk),
//                               'totaal':0,'verdeelsleutel':0});
//   };
//
//   //set verdeelsleutel voor elke eigenaar
//   let queryString = "SELECT units.id as id, units.naam as naam, units.duizendste as duizendste,"+
//                     "partners.naam as eigenaar, partners.id as eigenaarid from units " +
//                     "LEFT OUTER JOIN eigendom ON units.id = eigendom.unit " +
//                     "LEFT OUTER JOIN partners ON eigendom.eigenaar = partners.id " +
//                     "WHERE units.fk_gebouw = $1 ORDER BY units.naam";
//
//   const result2 = await pool.query(queryString, [req.gebouw]);
//
//   let qVerdeelsleutel = "SELECT verdeelsleutel FROM gebouwen WHERE id=$1"
//   const rVerdeelsleutel = await pool.query(qVerdeelsleutel, [req.gebouw])
//
//   for(let element of result2.rows){
//     let myObj = rapport.get(element.eigenaar);
//     myObj.verdeelsleutel = myObj.verdeelsleutel + element.duizendste
//     rapport.set(element.eigenaar,myObj);
//   };
//
//   let queryBankrekeningnr = "SELECT werkrekeningnummer "+
//                             "FROM gebouwen WHERE id=$1";
//
//   const resultsBankrekeningnr = await pool.query(queryBankrekeningnr, [req.gebouw])
//
//   //voorschotten en kosten
//   let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving FROM bankrekeninguittreksels as bu " +
//                     "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
//                     "WHERE bu.bankrekening = ($1) AND bu.fk_gebouw=$2;"
//
//   const result3 = await pool.query(queryString2, [resultsBankrekeningnr.rows[0].werkrekeningnummer, req.gebouw]);
//
//   for(let element of result3.rows){
//     //voorschotten
//     if(rapport.get(element.tegenpartij)&&element.type=='voorschot'){
//       let myObj = rapport.get(element.tegenpartij);
//       myObj.voorschotten = myObj.voorschotten+parseFloat(element.bedrag)
//       rapport.set(element.tegenpartij,myObj)
//     //kosten
//     }else{
//       //toekennen aan iedere eigenaar
//       rapport.forEach(function(value,key){
//         let verdeling = (element.bedrag*value.verdeelsleutel)/parseFloat(rVerdeelsleutel.rows[0].verdeelsleutel.toString());
//         value.uitgaven = value.uitgaven + verdeling
//         rapport.set(key,value);
//       });
//     }
//   }
//
//   let totaalVoorschotten = 0
//   let totaalUitgaven = 0
//   let totaalSaldo = 0
//   let totaalOvergenomensaldo = 0
//   let totaalTotaal = 0
//
//   rapport.forEach(function(value,key){
//     value.saldo = value.voorschotten + value.uitgaven
//     value.totaal = value.saldo + value.vorig_saldo
//     rapport.set(key,value);
//
//     totaalVoorschotten = totaalVoorschotten + value.voorschotten
//     totaalUitgaven = totaalUitgaven + value.uitgaven
//     totaalSaldo = totaalSaldo + value.saldo
//     totaalOvergenomensaldo = totaalOvergenomensaldo + value.vorig_saldo
//     totaalTotaal = totaalTotaal + value.totaal
//   })
//
//   rapport.set('Totaal',{'voorschotten':totaalVoorschotten,
//                         'uitgaven':totaalUitgaven,
//                         'saldo':totaalSaldo,
//                         'vorig_saldo':totaalOvergenomensaldo,
//                         'totaal':totaalTotaal});
//
//   console.log(rapport);
//   return res.status(200).send(Array.from(rapport));
//
// })

router.get('/werkrekeningrapport', verifyToken, async function(req, res) {
  console.log('werkrekeningrapport');

  let rapport = new Map();

  // const result = await pool.query('SELECT id, naam, voornaam, email, bankrnr, overgenomen_saldo_werk '+
  //                                 'FROM partners WHERE fk_gebouw = $1 AND fk_type=1', [req.gebouw]);

  // for(let element of result.rows){
  //   rapport.set(element.naam,{'voorschotten':0, 'uitgaven':0,'saldo':0,'vorig_saldo':0 || parseFloat(element.overgenomen_saldo_werk),
  //                             'totaal':0,'verdeelsleutel':0});
  // };

  // for(let element of result.rows){
  //   rapport.set(element.naam,{'opgevraagdevoorschotten':0, 'openstaandevoorschotten':0, 'uitgaven':0,'saldo':0,
  //                             'totaal':0,'verdeelsleutel':0});
  // };

  //get all units en de eigenaar
  let qUnits = "SELECT units.id as id, units.naam as naam, units.duizendste as duizendste,"+
                    "partners.naam as eigenaar, partners.id as eigenaarid from units " +
                    "LEFT OUTER JOIN eigendom ON units.id = eigendom.unit " +
                    "LEFT OUTER JOIN partners ON eigendom.eigenaar = partners.id " +
                    "WHERE units.fk_gebouw = $1 ORDER BY units.naam";

  const rUnits = await pool.query(qUnits, [req.gebouw]);

  let qVerdeelsleutel = "SELECT verdeelsleutel FROM gebouwen WHERE id=$1"
  const rVerdeelsleutel = await pool.query(qVerdeelsleutel, [req.gebouw])

  for(let element of rUnits.rows){
    rapport.set(element.naam,{'eigenaar':element.eigenaar,'opgevraagdevoorschotten':0, 'openstaandevoorschotten':0, 'uitgaven':0, 'totaal':0});
  };

  // for(let element of result2.rows){
  //   let myObj = rapport.get(element.eigenaar);
  //   myObj.verdeelsleutel = myObj.verdeelsleutel + element.duizendste
  //   rapport.set(element.eigenaar,myObj);
  // };

  //get de voorschotten
  let qVoorschotten = "SELECT vo.bedrag, vo.betaald, un.naam FROM voorschotten AS vo "+
                      "LEFT OUTER JOIN units AS un ON vo.fk_unit = un.id "+
                      "WHERE vo.fk_gebouw = $1"

  const rVoorschotten = await pool.query(qVoorschotten, [req.gebouw])

  //allocate de voorschotten
  for(let element of rVoorschotten.rows){
    let myObj = rapport.get(element.naam)
    myObj.opgevraagdevoorschotten = myObj.opgevraagdevoorschotten+parseFloat(element.bedrag)

    if(!element.betaald)
      myObj.openstaandevoorschotten = myObj.openstaandevoorschotten+parseFloat(element.bedrag)
  }

  //get de facturen
  let qFacturen = "SELECT fa.bedrag, fa.betaald, kt.verdeling, kt.id AS fk_kostentype FROM facturen AS fa "+
                  "LEFT OUTER JOIN kosten_types AS kt ON fa.fk_type = kt.id "+
                  "WHERE fa.fk_gebouw = $1"

  const rFacturen = await pool.query(qFacturen, [req.gebouw])

  //allocate de facturen
  for (let element of rFacturen.rows){
    if(element.verdeling=='algemeen'){
      //loop over units en alloceer de uitgave in functie van de algemene verdeelsleutel
      for(let element2 of rUnits.rows){
        let bedrag = (element.bedrag * element2.duizendste)/parseFloat(rVerdeelsleutel.rows[0].verdeelsleutel.toString())
        let myObj = rapport.get(element2.naam)
        myObj.uitgaven = myObj.uitgaven+bedrag
      }

    }else if(element.verdeling=='aangepast'){
      //get de aangepaste verdeling
      let qVerdeling = "SELECT ve.teller, un.naam FROM verdeling AS ve "+
                       "LEFT OUTER JOIN units AS un ON ve.fk_unit = un.id "+
                       "WHERE ve.fk_kostentype = $1"
      const rVerdeling = await pool.query(qVerdeling, [element.fk_kostentype])

      let qTotaalVerdeling = "SELECT SUM(teller) FROM verdeling "+
                             "WHERE fk_kostentype = $1"
      const rTotaalVerdeling = await pool.query(qTotaalVerdeling, [element.fk_kostentype])

      //loop over de units van de aangepaste verdeling
      for(let element2 of rVerdeling.rows){
        let bedrag = (element.bedrag * element2.teller)/parseFloat(rTotaalVerdeling.rows[0].sum.toString())
        let myObj = rapport.get(element2.naam)
        myObj.uitgaven = myObj.uitgaven+bedrag
      }


    }else if(element.verdeling =='verbruik'){
      //check of er een verbruik is ingevuld, if not: gebruik de algemene verdeling
      let qVerbruik = "SELECT * FROM verbruiken AS ve "+
                      "WHERE fk_kostentype = $1"
      let rVerbruik = await pool.query(qVerbruik, [element.fk_kostentype])

      if(rVerbruik.rows[0].totaalverbruik){
        console.log('verbruik')
      }else{
        console.log('using standaard verdeling')
        for(let element2 of rUnits.rows){
          let bedrag = (element.bedrag * element2.duizendste)/parseFloat(rVerdeelsleutel.rows[0].verdeelsleutel.toString())
          let myObj = rapport.get(element2.naam)
          myObj.uitgaven = myObj.uitgaven+bedrag
        }
      }

    }else{
      console.log('error - geen verdeling bepaald voor factuur')
    }
  }


  // let queryBankrekeningnr = "SELECT werkrekeningnummer "+
  //                           "FROM gebouwen WHERE id=$1";
  //
  // const resultsBankrekeningnr = await pool.query(queryBankrekeningnr, [req.gebouw])
  //
  // //voorschotten en kosten
  // let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving FROM bankrekeninguittreksels as bu " +
  //                   "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
  //                   "WHERE bu.bankrekening = ($1) AND bu.fk_gebouw=$2;"
  //
  // const result3 = await pool.query(queryString2, [resultsBankrekeningnr.rows[0].werkrekeningnummer, req.gebouw]);
  //
  // for(let element of result3.rows){
  //   //voorschotten
  //   if(rapport.get(element.tegenpartij)&&element.type=='voorschot'){
  //     let myObj = rapport.get(element.tegenpartij);
  //     myObj.voorschotten = myObj.voorschotten+parseFloat(element.bedrag)
  //     rapport.set(element.tegenpartij,myObj)
  //   //kosten
  //   }else{
  //     //toekennen aan iedere eigenaar
  //     rapport.forEach(function(value,key){
  //       let verdeling = (element.bedrag*value.verdeelsleutel)/parseFloat(rVerdeelsleutel.rows[0].verdeelsleutel.toString());
  //       value.uitgaven = value.uitgaven + verdeling
  //       rapport.set(key,value);
  //     });
  //   }
  // }

  let totaalOpgevraagdeVoorschotten = 0
  let totaalOpenstaandeVoorschotten = 0
  let totaalUitgaven = 0
  let totaalSaldo = 0
  let totaalOvergenomensaldo = 0
  let totaalTotaal = 0

  rapport.forEach(function(value,key){
    //value.saldo = value.voorschotten + value.uitgaven
    value.totaal = value.opgevraagdevoorschotten + value.openstaandevoorschotten + value.uitgaven
    rapport.set(key,value);

    totaalOpgevraagdeVoorschotten = totaalOpgevraagdeVoorschotten + value.opgevraagdevoorschotten
    totaalOpenstaandeVoorschotten = totaalOpenstaandeVoorschotten + value.openstaandevoorschotten
    totaalUitgaven = totaalUitgaven + value.uitgaven
    // totaalSaldo = totaalSaldo + value.saldo
    // totaalOvergenomensaldo = totaalOvergenomensaldo + value.vorig_saldo
    totaalTotaal = totaalTotaal + value.totaal
  })

  rapport.set('Totaal',{'opgevraagdevoorschotten':totaalOpgevraagdeVoorschotten,
                        'openstaandevoorschotten':totaalOpenstaandeVoorschotten,
                        'uitgaven':totaalUitgaven,
                        // 'saldo':totaalSaldo,
                        // 'vorig_saldo':totaalOvergenomensaldo,
                        'totaal':totaalTotaal});

  console.log(rapport);
  return res.status(200).send(Array.from(rapport));

})

router.get('/inkomstenrapport', verifyToken, async function(req, res) {
  console.log('inkomstenrapport');

  let rapport = new Map();

  //get eigenaars
  const result = await pool.query('SELECT id, naam, voornaam, email, bankrnr '+
                                  'FROM partners WHERE fk_gebouw = $1 AND fk_type=1', [req.gebouw]);

  for(let element of result.rows){
    rapport.set(element.naam,{'0':0,'1':0,'2':0,'3':0,'4':0,'5':0,
                              '6':0,'7':0,'8':0,'9':0,'10':0,'11':0,'12':0});
  };

  let queryBankrekeningnr = "SELECT werkrekeningnummer "+
                            "FROM gebouwen WHERE id=$1";

  const resBankrekeningnr = await pool.query(queryBankrekeningnr, [req.gebouw])

  //loop over uittreksels
  // let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type FROM bankrekeninguittreksels as bu " +
  //                   "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
  //                   "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
  //                   "WHERE bu.bankrekening = ($1) AND bu.fk_gebouw = $2;"

  let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving FROM bankrekeninguittreksels as bu " +
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
  const result = await pool.query('SELECT id, naam, voornaam, email, bankrnr '+
                                  'FROM partners WHERE fk_gebouw = $1 AND fk_type>1', [req.gebouw]);

  for(let element of result.rows){
    rapport.set(element.naam,{'0':0,'1':0,'2':0,'3':0,'4':0,'5':0,
                              '6':0,'7':0,'8':0,'9':0,'10':0,'11':0,'12':0});
  };

  let queryBankrekeningnr = "SELECT werkrekeningnummer "+
                            "FROM gebouwen WHERE id=$1";

  const resBankrekeningnr = await pool.query(queryBankrekeningnr, [req.gebouw])

  //loop over uittreksels
  // let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type FROM bankrekeninguittreksels as bu " +
  //                   "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
  //                   "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
  //                   "WHERE bu.bankrekening = ($1) AND bu.fk_gebouw = $2;"

  let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving FROM bankrekeninguittreksels as bu " +
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

  //get facturen
  const queryFacturen = "SELECT SUM(fa.bedrag), ko.naam as kostentype, ko.id, ko.verdeling FROM facturen AS fa "+
                         "LEFT OUTER JOIN kosten_types AS ko ON fa.fk_type = ko.id "+
                         "WHERE fa.datum >= ($1) AND fa.datum <= ($2) AND fa.fk_gebouw = $3 "+
                         "GROUP BY ko.naam, ko.verdeling, ko.id"

  const resultsFacturen = await pool.query(queryFacturen, [req.query.van, req.query.tot, req.gebouw])

  //loop over facturen
  for(let factuur of resultsFacturen.rows){
    console.log(factuur.verdeling)
    //ingeval van standaardverdeling > loop over units en voeg gewoon toe aan array
    if(factuur.verdeling=='algemeen'){
      for(let unit of resultsUnits.rows){
        let unitBedrag = parseFloat(factuur.sum) * (parseFloat(unit.duizendste) / parseFloat(resultsGebouw.rows[0].verdeelsleutel))
        results.push([unit.naam, factuur.kostentype, -factuur.sum, unit.duizendste, resultsGebouw.rows[0].verdeelsleutel, -unitBedrag || '0'])
      }
    }

    //ingeval van verbruik > haal de verbruikverdeling op en gebruik deze verdeling om toe te voegen aan array
    if(factuur.verdeling=='verbruik'){

      //haal de verbruiksverdeling op
      const queryVerbruik = "SELECT * FROM verbruiken where fk_kostentype = $1"
      const resultVerbruik = await pool.query(queryVerbruik, [factuur.id])
      let totaalverbruik = resultVerbruik.rows[0].totaalverbruik

      const queryVerbruikItems = "SELECT * FROM verbruik_items WHERE verbruik_fk = $1"
      const resultVerbruikItems = await pool.query(queryVerbruikItems, [resultVerbruik.rows[0].id])

      for(let unit of resultsUnits.rows){

        for(let verbruik of resultVerbruikItems.rows){
          if(verbruik.unit_fk===unit.id){
            let unitBedrag = parseFloat(factuur.sum) * (parseFloat(verbruik.verbruikt) / parseFloat(totaalverbruik))
            results.push([unit.naam, factuur.kostentype, -factuur.sum, verbruik.verbruikt, totaalverbruik, -unitBedrag || '0'])
          }
        }
      }
    }

    //ingeval van afwijkende verdeling > haal de verdeling op en gebruik deze verdeling om toe te voegen aan array
    if(factuur.verdeling=='aangepast'){

      //haal de afwijkende verdeling op
      console.log(factuur.id)
      const queryVerdeling = "SELECT * FROM verdeling where fk_kostentype = $1"
      const resultVerdeling = await pool.query(queryVerdeling, [uittreksel.id])

      //haal de verdeelsleutel
      const queryVerdeelsleutel = "SELECT SUM(teller) FROM verdeling where fk_kostentype = $1"
      const resultVerdeelsleutel = await pool.query(queryVerdeelsleutel, [uittreksel.id])
      let verdeelsleutel = resultVerdeelsleutel.rows[0].sum

      for(let unit of resultsUnits.rows){

        for(let verdeling of resultVerdeling.rows){
          if(verdeling.fk_unit===unit.id){
            let unitBedrag = parseFloat(factuur.sum) * (parseFloat(verdeling.teller) / parseFloat(verdeelsleutel))
            results.push([unit.naam, factuur.kostentype, -factuur.sum, verdeling.teller, verdeelsleutel, -unitBedrag || '0'])
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
      from:'info@sndx.be',
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
        res.status(200).send({'status':'OK'});
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

router.post('/sendmessage', verifyToken, function(req,res){
  console.log('POST sendmessage')
  console.log(req.body)

  let mailText = "Beste, \n\n" +
                 "We ontvingen onderstaande vraag van u, we gaan er zo snel mogelijk mee aan de slag. \n\n" +
                 "--------- \n\n "+req.body.text


  //send mail
  let options1 = {
    from:'info@sndx.be',
    to:req.body.email,
    subject:'Uw vraag via SNDX.be',
    text:mailText,
  }

  transporter.sendMail(options1, function(error,info){
    if(error){
      console.log(error);
    }else{
      console.log('Email sent: ' + info.response);
      res.status(200).send({'status':'OK'});
    }
  })

  mailText = "Verzender: " + req.body.email + '\n\n' +
             "Pagina: " + req.body.page + '\n\n' +
             "Vraag: " + req.body.text + '\n\n'

  let options2 = {
    from:'info@sndx.be',
    to:'cindy.keersmaekers@gmail.com',
    subject:'Vraag om help via SNDX.be',
    text:mailText,
  }

  transporter.sendMail(options2, function(error,info){
    if(error){
      console.log(error);
    }else{
      console.log('Email sent: ' + info.response);
      res.status(200).send({'status':'OK'});
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

    console.log(req.gebouw)

    //get rekeningnummers
    const result = await pool.query('SELECT werkrekeningnummer, reserverekeningnummer FROM gebouwen WHERE id = ($1)', [req.gebouw]);

    console.log(result.rows[0])

    rekeningnummers = new Map();
    rekeningnummers.set(result.rows[0].werkrekeningnummer, 1);
    rekeningnummers.set(result.rows[0].reserverekeningnummer, 2);

    //get partners: fk's en types
    const p_result = await pool.query('SELECT id, bankrnr, bankrnr2 FROM partners WHERE fk_gebouw = ($1)', [req.gebouw]);

    p_rekeningnummers = new Map();
    if(p_result.rows){
      p_result.rows.forEach((element)=>{
        p_rekeningnummers.set(element.bankrnr,element.id);
        if(element.bankrnr2)
          p_rekeningnummers.set(element.bankrnr2, element.id)
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

            let queryString = 'INSERT INTO bankrekeninguittreksels (datum, bedrag, omschrijving, tegenrekening, bankrekening, fk_partner, fk_gebouw, linked) '+
                              'VALUES ($1, $2, $3, $4, $5, $6, $7, false) RETURNING id';
            const results = await pool.query(queryString,[date,
                                                          bedrag.replace(",","."),
                                                          omschrijving.substr(0,299),
                                                          tegenrekening,
                                                          rekeningnummer,
                                                          p_rekeningnummers.get(tegenrekening),
                                                          req.gebouw])

          }
        }

        invoiceMatch(0,req,res)
        voorschotMatch(0,req,res)

        fs.unlinkSync(req.file.path);
        return res.sendStatus(200);
      });

});

router.get('/invoicematch', verifyToken, async function (req, res) {
  voorschotMatch(0, req, res)
  return res.sendStatus(200)
});

async function invoiceMatch(fk_partner, req, res){
  //get open invoices
  let qInvoices = "SELECT * FROM facturen WHERE betaald=false AND fk_gebouw=$1 ORDER BY datum"
  let rInvoices = await pool.query(qInvoices, [req.gebouw])

  //get unlinked uittreksels
  let qBank = "SELECT * FROM bankrekeninguittreksels WHERE linked=false AND fk_gebouw=$1 ORDER BY datum"
  let rBank = await pool.query(qBank, [req.gebouw])

  //loop over invoices
  for(let invoice of rInvoices.rows){

    for(let bank of rBank.rows){

      for(let bank2 of rBank.rows){

        for(let bank3 of rBank.rows){
          if(!(bank.id==bank2.id||bank.id==bank3.id||bank2.id==bank3.id)){
            if(invoice.fk_partner==bank.fk_partner&&invoice.fk_partner==bank2.fk_partner&&invoice.fk_partner==bank3.fk_partner){
              if(parseFloat(invoice.bedrag)==parseFloat(-bank.bedrag-bank2.bedrag-bank3.bedrag)){
                if(!invoice.matched&&!bank.matched&&!bank2.matched&&!bank3.matched){
                  invoice.matched=true
                  bank.matched=true
                  bank2.matched=true
                  bank3.matched=true
                  console.log('part 1A')
                  await pool.query('UPDATE facturen SET betaald = true WHERE id=$1',[invoice.id]);
                  await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank.id]);
                  await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank2.id]);
                  await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank3.id]);
                  await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[bank.id,invoice.id]);
                  await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[bank2.id,invoice.id]);
                  await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[bank3.id,invoice.id]);
                }
              }
            }
          }
        }

        if(bank.id!=bank2.id){
          if(invoice.fk_partner==bank.fk_partner&&bank.fk_partner==bank2.fk_partner&&parseFloat(invoice.bedrag)==parseFloat(-bank.bedrag-bank2.bedrag)){
            if(!invoice.matched&&!bank.matched&&!bank2.matched){
              invoice.matched=true
              bank.matched=true
              bank2.matched=true
              console.log('part 2A')
              await pool.query('UPDATE facturen SET betaald = true WHERE id=$1',[invoice.id]);
              await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank.id]);
              await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank2.id]);
              await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[bank.id,invoice.id]);
              await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[bank2.id,invoice.id]);
            }
          }
        }
      }

      if(invoice.fk_partner==bank.fk_partner&&invoice.bedrag==-bank.bedrag){
        if(!invoice.matched&&!bank.matched){
          invoice.matched=true
          bank.matched=true
          console.log('part 3A')
          console.log(bank.id)
          console.log(invoice.id)
          await pool.query('UPDATE facturen SET betaald = true WHERE id=$1',[invoice.id]);
          console.log('finish 1')
          await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank.id]);
          console.log('finish 2')
          await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[bank.id,invoice.id]);
          console.log('finish 3')
        }
      }
    }
  }

  //get open invoices
  qInvoices = "SELECT * FROM facturen WHERE betaald=false AND fk_gebouw=$1 ORDER BY datum"
  rInvoices = await pool.query(qInvoices, [req.gebouw])

  //get unlinked uittreksels
  qBank = "SELECT * FROM bankrekeninguittreksels WHERE linked=false AND fk_gebouw=$1 ORDER BY datum"
  rBank = await pool.query(qBank, [req.gebouw])

  //loop over uittreksels
  for(let bank of rBank.rows){

    for(let invoice of rInvoices.rows){

      for(let invoice2 of rInvoices.rows){

        for(let invoice3 of rInvoices.rows){
          if(!(invoice.id==invoice2.id||invoice.id==invoice3.id||invoice2.id==invoice3.id)){
            if(bank.fk_partner==invoice.fk_partner&&bank.fk_partner==invoice2.fk_partner&&bank.fk_partner==invoice3.fk_partner){
              if(parseFloat(bank.bedrag)==parseFloat(-invoice.bedrag-invoice2.bedrag-invoice.bedrag)){
                if(!bank.matched&&!invoice.matched&&!invoice2.matched&&!invoice3.matched){
                  bank.matched=true
                  invoice.matched=true
                  invoice2.matched=true
                  invoice3.matched=true
                  console.log('part 1B')
                  await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank.id]);
                  await pool.query('UPDATE facturen SET betaald = true WHERE id=$1',[invoice.id]);
                  await pool.query('UPDATE facturen SET betaald = true WHERE id=$1',[invoice2.id]);
                  await pool.query('UPDATE facturen SET betaald = true WHERE id=$1',[invoice3.id]);
                  await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[bank.id,invoice.id]);
                  await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[bank.id,invoice2.id]);
                  await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[bank.id,invoice3.id]);
                }
              }
            }
          }
        }

        if(invoice.id!=invoice2.id){
          if(bank.fk_partner==invoice.fk_partner&&bank.fk_partner==invoice2.fk_partner&&parseFloat(bank.bedrag)==parseFloat(-invoice.bedrag-invoice2.bedrag)){
            if(!bank.matched&&!invoice.matched&&!invoice2.matched){
              bank.matched=true
              invoice.matched=true
              invoice2.matched=true
              console.log('part 2B')
              await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank.id]);
              await pool.query('UPDATE facturen SET betaald = true WHERE id=$1',[invoice.id]);
              await pool.query('UPDATE facturen SET betaald = true WHERE id=$1',[invoice2.id]);
              await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[bank.id,invoice.id]);
              await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[bank.id,invoice2.id]);
            }
          }
        }
      }

      if(bank.fk_partner==invoice.fk_partner&&bank.bedrag==-invoice.bedrag){
        if(!invoice.matched&&!bank.matched){
          invoice.matched=true
          bank.matched=true
          console.log('part 3B')
          await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank.id]);
          await pool.query('UPDATE facturen SET betaald = true WHERE id=$1',[invoice.id]);
          await pool.query('INSERT INTO bank_factuur (bank_id, factuur_id) VALUES ($1, $2)',[bank.id,invoice.id]);
        }
      }
    }
  }
}

async function voorschotMatch(fk_partner, req, res){
  //get open voorschotten
  let qInvoices = "SELECT * FROM voorschotten WHERE betaald=false AND fk_gebouw=$1 ORDER BY datum"
  let rInvoices = await pool.query(qInvoices, [req.gebouw])

  //get unlinked uittreksels
  let qBank = "SELECT * FROM bankrekeninguittreksels WHERE linked=false AND fk_gebouw=$1 ORDER BY datum"
  let rBank = await pool.query(qBank, [req.gebouw])

  //loop over invoices
  for(let invoice of rInvoices.rows){

    for(let bank of rBank.rows){

      for(let bank2 of rBank.rows){

        for(let bank3 of rBank.rows){
          if(!(bank.id==bank2.id||bank.id==bank3.id||bank2.id==bank3.id)){
            if(invoice.fk_partner==bank.fk_partner&&invoice.fk_partner==bank2.fk_partner&&invoice.fk_partner==bank3.fk_partner){
              if(parseFloat(invoice.bedrag)==parseFloat(bank.bedrag)+parseFloat(bank2.bedrag)+parseFloat(bank3.bedrag)){
                if(!invoice.matched&&!bank.matched&&!bank2.matched&&!bank3.matched){
                  invoice.matched=true
                  bank.matched=true
                  bank2.matched=true
                  bank3.matched=true
                  await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1',[invoice.id]);
                  await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank.id]);
                  await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank2.id]);
                  await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank3.id]);
                  await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[bank.id,invoice.id]);
                  await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[bank2.id,invoice.id]);
                  await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[bank3.id,invoice.id]);
                }
              }
            }
          }
        }

        if(bank.id!=bank2.id){
          if(invoice.fk_partner==bank.fk_partner&&bank.fk_partner==bank2.fk_partner&&parseFloat(invoice.bedrag)==parseFloat(bank.bedrag)+parseFloat(bank2.bedrag)){
            if(!invoice.matched&&!bank.matched&&!bank2.matched){
              invoice.matched=true
              bank.matched=true
              bank2.matched=true
              await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1',[invoice.id]);
              await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank.id]);
              await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank2.id]);
              await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[bank.id,invoice.id]);
              await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[bank2.id,invoice.id]);
            }
          }
        }
      }

      if(invoice.fk_partner==bank.fk_partner&&parseFloat(invoice.bedrag)==parseFloat(bank.bedrag)){
        if(!invoice.matched&&!bank.matched){
          invoice.matched=true
          bank.matched=true
          await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1',[invoice.id]);
          await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank.id]);
          await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[bank.id,invoice.id]);
        }
      }
    }
  }

  //get open invoices
  qInvoices = "SELECT * FROM voorschotten WHERE betaald=false AND fk_gebouw=$1 ORDER BY datum"
  rInvoices = await pool.query(qInvoices, [req.gebouw])

  //get unlinked uittreksels
  qBank = "SELECT * FROM bankrekeninguittreksels WHERE linked=false AND fk_gebouw=$1 ORDER BY datum"
  rBank = await pool.query(qBank, [req.gebouw])

  //loop over uittreksels
  for(let bank of rBank.rows){

    for(let invoice of rInvoices.rows){

      for(let invoice2 of rInvoices.rows){

        for(let invoice3 of rInvoices.rows){
          if(!(invoice.id==invoice2.id||invoice.id==invoice3.id||invoice2.id==invoice3.id)){
            if(bank.fk_partner==invoice.fk_partner&&bank.fk_partner==invoice2.fk_partner&&bank.fk_partner==invoice3.fk_partner){
              if(parseFloat(bank.bedrag)==parseFloat(invoice.bedrag)+parseFloat(invoice2.bedrag)+parseFloat(invoice.bedrag)){
                if(!bank.matched&&!invoice.matched&&!invoice2.matched&&!invoice3.matched){
                  bank.matched=true
                  invoice.matched=true
                  invoice2.matched=true
                  invoice3.matched=true
                  await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank.id]);
                  await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1',[invoice.id]);
                  await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1',[invoice2.id]);
                  await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1',[invoice3.id]);
                  await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[bank.id,invoice.id]);
                  await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[bank.id,invoice2.id]);
                  await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[bank.id,invoice3.id]);
                }
              }
            }
          }
        }

        if(invoice.id!=invoice2.id){
          if(bank.fk_partner==invoice.fk_partner&&bank.fk_partner==invoice2.fk_partner&&parseFloat(bank.bedrag)==parseFloat(invoice.bedrag)+parseFloat(invoice2.bedrag)){
            if(!bank.matched&&!invoice.matched&&!invoice2.matched){
              bank.matched=true
              invoice.matched=true
              invoice2.matched=true
              await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank.id]);
              await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1',[invoice.id]);
              await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1',[invoice2.id]);
              await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[bank.id,invoice.id]);
              await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[bank.id,invoice2.id]);
            }
          }
        }
      }

      if(bank.fk_partner==invoice.fk_partner&&parseFloat(bank.bedrag)==parseFloat(invoice.bedrag)){
        if(!invoice.matched&&!bank.matched){
          invoice.matched=true
          bank.matched=true
          await pool.query('UPDATE bankrekeninguittreksels SET linked = true WHERE id=$1',[bank.id]);
          await pool.query('UPDATE voorschotten SET betaald = true WHERE id=$1',[invoice.id]);
          await pool.query('INSERT INTO bank_voorschot (bank_id, voorschot_id) VALUES ($1, $2)',[bank.id,invoice.id]);
        }
      }
    }
  }
}

module.exports = router;
