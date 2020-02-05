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

router.post('/mail',(req,res)=>{
  transporter.sendMail(mailOptions, function(error,info){
    if(error){
      console.log(error);
    }else{
      console.log(req);
      console.log('Email sent: ' + info.response);
      res.status(200).send('OK');
    }
  })
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

router.post('/register', async function (req, res){
  let userData = req.body
  let user = new User(userData);


  let resultsGebouwen = await pool.query('INSERT INTO gebouwen (overgenomen_saldo_werk, overgenomen_saldo_reserve) VALUES (0, 0) RETURNING id')

  let results = await pool.query('INSERT INTO users (email, password, fk_gebouw) VALUES ($1, $2, $3) RETURNING id',
                               [user.email, user.password, resultsGebouwen.rows[0].id]);

  let payload = {subject:results.rows[0].id, gebouw: resultsGebouwen.rows[0].id};
  let token = jwt.sign(payload, config.key);
  res.status(200).send({token});
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

  pool.query("INSERT INTO partners (naam, voornaam, bankrnr, email, fk_type, fk_gebouw) VALUES ($1, $2, $3, $4, 1, $5) RETURNING id",
                [req.body.naam, req.body.voornaam, req.body.bankrnr, req.body.email, req.gebouw], (error, results) => {
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
                    res.status(200).send(results);
                  }
                })

}

router.put('/eigenaars', verifyToken, (req,res) => {
  console.log('put eigenaars');

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

  pool.query('SELECT id, naam, voornaam, email, bankrnr from partners WHERE id = $1', [req.query.id], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      res.status(200).send(results.rows[0]);
    }
  })

});

router.get('/eigenaars', verifyToken, (req, res) =>{
  console.log('get eigenaars');

  pool.query('SELECT id, naam, voornaam, email, bankrnr from partners WHERE fk_gebouw = $1 AND fk_type=1', [req.gebouw], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      res.status(200).send(results.rows);
    }
  })

});

router.get('/uittreksels', verifyToken, (req,res)=>{
  console.log('get uittreksels');

  let queryString = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type, bu.fk_factuur as factuur FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN bankrekeningen as br ON bu.fk_bankrekening = br.id " +
                    "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
                    "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
                    "WHERE br.fk_gebouw = ($1) AND br.type = ($2) ORDER BY bu.datum DESC;"

  pool.query(queryString, [req.gebouw,req.query.type], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      res.status(200).send(results.rows);
    }
  })
})

router.get('/uittreksel', verifyToken, (req,res)=>{
  console.log('get uittreksel');
  console.log(req.query.id);

  let queryString = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, pa.naam as tegenpartij, bu.omschrijving, kt.naam as type, bu.fk_type as fk_type FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN partners as pa on bu.fk_partner = pa.id " +
                    "LEFT OUTER JOIN kosten_types as kt on bu.fk_type = kt.id " +
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
                    "WHERE br.fk_gebouw = ($1) AND br.type = 'werk' AND bu.fk_partner is Null;"

  pool.query(queryString, [req.gebouw], (error, results) => {
    if(error) {
      console.log(error)
    }else{
      console.log(results.rows);
      res.status(200).send(results.rows);
    }
  })
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

router.post('/facturen', verifyToken, async function (req,res){

  factuurID = null;

  const results1 = await pool.query("INSERT INTO facturen (bedrag, omschrijving, datum, vervaldatum, fk_partner, fk_gebouw, type) VALUES ($1, $2, $3, $4, $5, $6, 'leverancier') RETURNING id",
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

router.post('/instellingen', verifyToken, (req, res) => {

  const queryString = "INSERT INTO instellingen (adres, periodiciteit_voorschot, dag_voorschot, " +
                      "kosten, werkrekeningnummer, overgenomen_werkrekening, reserverekeningnummer, " +
                      "overgenomen_reserverekening, fk_gebouw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id"

  pool.query(queryString, [req.body.adres, req.body.periodiciteit, req.body.voorschotdag,
                            req.body.kosten, req.body.werkrekeningnummer,
                            req.body.overgenomen_werkrekening, req.body.reserverekeningnummer,
                            req.body.overgenomen_reserverekening, req.gebouw], (error, results) => {
                              if(error){
                                console.log(error);
                              }else{
                                res.status(200).send(results);
                              }
                            })
})

router.put('/instellingen', verifyToken, (req, res) => {

  const queryString = "UPDATE instellingen SET adres=$1, periodiciteit_voorschot=$2, dag_voorschot=$3, " +
                      "kosten=$4, werkrekeningnummer=$5, overgenomen_werkrekening=$6, reserverekeningnummer=$7, " +
                      "overgenomen_reserverekening=$8 WHERE fk_gebouw=$9"

  pool.query(queryString, [req.body.adres, req.body.periodiciteit, req.body.voorschotdag,
                            req.body.kosten, req.body.werkrekeningnummer,
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

  const queryString = "SELECT * from instellingen where fk_gebouw = $1"

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
router.get('/werkrekeningsaldo', verifyToken, (req,res)=>{
  let queryString = "SELECT sum(bu.bedrag) "+
                    "FROM public.bankrekeninguittreksels AS bu "+
                    "LEFT OUTER JOIN bankrekeningen AS br ON bu.fk_bankrekening = br.id "+
                    "WHERE br.fk_gebouw = $1 AND br.type = 'werk'";

  pool.query(queryString, [req.gebouw], (error, results)=>{
    if(error) console.log(error)
    else res.status(200).send(results)
  })
})

router.get('/reserverekeningsaldo', verifyToken, (req,res)=>{
  let queryString = "SELECT sum(bu.bedrag) "+
                    "FROM public.bankrekeninguittreksels AS bu "+
                    "LEFT OUTER JOIN bankrekeningen AS br ON bu.fk_bankrekening = br.id "+
                    "WHERE br.fk_gebouw = $1 AND br.type = 'reserve'";

  pool.query(queryString, [req.gebouw], (error, results)=>{
    if(error) console.log(error)
    else res.status(200).send(results)
  })
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

  //voorschotten en kosten
  let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type, bu.fk_factuur as factuur FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN bankrekeningen as br ON bu.fk_bankrekening = br.id " +
                    "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
                    "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
                    "WHERE br.fk_gebouw = ($1) AND br.type = 'werk';"

  const result3 = await pool.query(queryString2, [req.gebouw]);

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

  //loop over uittreksels
  let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type, bu.fk_factuur as factuur FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN bankrekeningen as br ON bu.fk_bankrekening = br.id " +
                    "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
                    "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
                    "WHERE br.fk_gebouw = ($1) AND br.type = 'werk';"

  const result2 = await pool.query(queryString2, [req.gebouw]);

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

  //loop over uittreksels
  let queryString2 = "SELECT bu.id, bu.datum, bu.bedrag, bu.tegenrekening, p.naam as tegenpartij, bu.omschrijving, kt.naam as type, bu.fk_factuur as factuur FROM bankrekeninguittreksels as bu " +
                    "LEFT OUTER JOIN bankrekeningen as br ON bu.fk_bankrekening = br.id " +
                    "LEFT OUTER JOIN kosten_types as kt ON bu.fk_type = kt.id " +
                    "LEFT OUTER JOIN partners as p ON bu.fk_partner = p.id " +
                    "WHERE br.fk_gebouw = ($1) AND br.type = 'werk';"

  const result2 = await pool.query(queryString2, [req.gebouw]);

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

  //bankrekening
  let queryString2 = "SELECT SUM(bedrag) as som FROM bankrekeninguittreksels AS bu "+
                    "JOIN bankrekeningen AS br ON bu.fk_bankrekening = br.id "+
                    "WHERE br.fk_gebouw = $1 AND type = 'werk'";

  const result2 = await pool.query(queryString2, [req.gebouw]);

  rapport.bank = result2.rows[0].som;

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

router.get('/inkomsten', verifyToken, (req,res)=>{
  const queryString = "SELECT date_trunc( 'month', bu.datum ), SUM(bu.bedrag) "+
                      "FROM bankrekeninguittreksels AS bu "+
                      "LEFT OUTER JOIN bankrekeningen AS br ON bu.fk_bankrekening = br.id "+
                      "WHERE bu.bedrag>0 AND br.fk_gebouw = $1 "+
                      "GROUP BY date_trunc( 'month', bu.datum ) ORDER BY date_trunc( 'month', bu.datum );"

  pool.query(queryString, [req.gebouw], (error, results) => {
    if(error) console.log(error)
    else res.status(200).send(results)
  })

})

router.get('/uitgaven', verifyToken, (req,res)=>{
  const queryString = "SELECT date_trunc( 'month', bu.datum ), SUM(bu.bedrag) "+
                      "FROM bankrekeninguittreksels AS bu "+
                      "LEFT OUTER JOIN bankrekeningen AS br ON bu.fk_bankrekening = br.id "+
                      "WHERE bu.bedrag<0 AND br.fk_gebouw = $1 "+
                      "GROUP BY date_trunc( 'month', bu.datum ) ORDER BY date_trunc( 'month', bu.datum );"

  pool.query(queryString, [req.gebouw], (error, results) => {
    if(error) console.log(error)
    else res.status(200).send(results)
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
    const result = await pool.query('SELECT id, rekeningnummer FROM bankrekeningen WHERE fk_gebouw = ($1)', [req.gebouw]);

    rekeningnummers = new Map();
    if(result.rows){
      result.rows.forEach((element)=>{
        rekeningnummers.set(element.rekeningnummer,element.id);
      })
    }

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

            let queryString = 'INSERT INTO bankrekeninguittreksels (datum, bedrag, omschrijving, tegenrekening, fk_bankrekening, fk_partner, fk_type, fk_factuur) '+
                              'VALUES ($1, $2, $3, $4, $5, $6, $7, Null) RETURNING id';
            const results = await pool.query(queryString,[date,
                                                          data[8].replace(",","."),
                                                          data[6].substr(0,299),
                                                          data[12],
                                                          rekeningnummers.get(data[0]),
                                                          p_rekeningnummers.get(data[12]),
                                                          p_types.get(data[12])])//,

            //TODO: check of dit een factuur betaald
            const f_result = await pool.query('SELECT id, bedrag, fk_partner FROM facturen where fk_uittreksel IS NULL and fk_gebouw = $1 ORDER BY datum', [req.gebouw]);
            console.log(f_result.rows);

            for(let element of f_result.rows){
              console.log(data[8].replace(",","."))
              console.log(p_rekeningnummers.get(data[12]))
              console.log(results.rows[0].id)
              console.log(element.id)
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
