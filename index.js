const express = require('express')
const path = require('path')
const ejsMate = require('ejs-mate')
const session = require('express-session')
const mongoose = require('mongoose')
const passport = require('passport')
const LocalStrategy = require('passport-local')
const Window = require('window')
const flash = require('connect-flash')
const window = new Window()

const Bill = require('./models/bill')
const User = require('./models/user')
const Item = require('./models/item')
const Sales = require('./models/sales')
const { isLoggedIn } = require('./middleware')

mongoose.connect('mongodb://localhost:27017/superMarket')

const db = mongoose.connection
db.on('error', console.error.bind(console, 'connection error:'))
db.once('open', () => {
  console.log('Database connected')
})

const app = express()
app.engine('ejs', ejsMate)
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))
app.set('public', path.join(__dirname, 'node_modules'))

app.use(express.urlencoded({ extended: true }))

const sessionConfig = {
  secret: 'supermarketapp',
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    expires: Date.now() + 1000 * 60 * 60 * 24 * 2, //expires after two days
    maxAge: 1000 * 60 * 60 * 24 * 2,
  },
}

app.use(session(sessionConfig))
app.use(flash())

app.use(passport.initialize())
app.use(passport.session())
passport.use(new LocalStrategy(User.authenticate()))

passport.serializeUser(User.serializeUser())
passport.deserializeUser(User.deserializeUser())

app.use((req, res, next) => {
  res.locals.currentUser = req.user
  res.locals.success = req.flash('success')
  res.locals.error = req.flash('error')
  next()
})

app.get('/', (req, res) => {
  res.render('login')
})

// authentications

app.get('/login', (req, res) => {
  res.render('login')
})

app.post(
  '/login',
  passport.authenticate('local', {
    failureFlash: true,
    failureRedirect: '/login',
  }),
  async (req, res) => {
    req.flash('success', 'Welcome back!')
    res.redirect('/welcome')
  }
)

app.get('/logout', isLoggedIn, async (req, res) => {
  req.logout(req.user, (err) => {
    if (err) return next(err)
    req.flash('success', 'Goodbye!')
    res.redirect('/login')
  })
})

app.get('/register', (req, res) => {
  res.render('register')
})

app.post('/register', async (req, res) => {
  try {
    const { name, username, user_type, password } = req.body
    joining_date = Date.now()
    const user = new User({ name, user_type, joining_date, username })
    const newuser = await User.register(user, password)
    req.login(newuser, (err) => {
      if (err) return next(err)
      req.flash('success', 'Welcome new user!')
      res.redirect('/welcome')
    })
  } catch (e) {
    req.flash('error', e.message)
    res.redirect('register')
  }
})

//common

app.get('/profile', isLoggedIn, async (req, res) => {
  res.render('profile')
})

app.get('/about', isLoggedIn, async (req, res) => {
  res.render('about')
})

app.get('/welcome', isLoggedIn, async (req, res) => {
  res.render('welcome')
})

//manager

app.get('/stat', isLoggedIn, async (req, res) => {
  if (res.locals.currentUser.user_type != 'Manager') {
    req.flash('error', 'Only Manager is authorized for this action')
    res.redirect('/welcome')
  }
  var filter = 0
  try {
    const allsalesforpie = await Sales.aggregate([
      {
        $match: {},
      },
      {
        $group: {
          _id: '$item_name',
          total: {
            $sum: { $multiply: ['$quantity', '$unit_price'] },
          },
        },
      },
      {
        $addFields: {
          item_name: '$_id',
        },
      },
    ])
    const allsales = await Sales.find({})
    const allDetails = await Item.find({})
    res.render('sales_stat', { allsales, allDetails, allsalesforpie, filter })
  } catch (err) {
    console.error(err)
    res.status(500).send('Internal Server Error')
  }
})

app.post('/stat', isLoggedIn, async (req, res) => {
  var filter = req.body.filter
  try {
    const allsalesforpie = await Sales.aggregate([
      {
        $match: {},
      },
      {
        $group: {
          _id: '$item_name',
          total: {
            $sum: { $multiply: ['$quantity', '$unit_price'] },
          },
        },
      },
      {
        $addFields: {
          item_name: '$_id',
        },
      },
    ])
    const allsales = await Sales.find({})
    const allDetails = await Item.find({})
    res.render('sales_stat', { allsales, allDetails, allsalesforpie, filter })
  } catch (err) {
    console.error(err)
    res.status(500).send('Internal Server Error')
  }
})

app.get('/bill', isLoggedIn, async (req, res) => {
  if (res.locals.currentUser.user_type != 'Clerk') {
    req.flash('error', 'Only Sales Clerk is authorized for this action')
    res.redirect('/welcome')
  }
  const items = await Item.find({})
  res.render('bill', { items })
})

app.post('/bill', isLoggedIn, async (req, res) => {
  if (res.locals.currentUser.user_type != 'Clerk') {
    req.flash('error', 'Only Sales Clerk is authorized for this action')
    res.redirect('/welcome')
  }
  var bill = req.body
  console.log(bill)
  const date = new Date()
  bill.date = date

  var bill_items = []

  for (let i = 0; i < bill.code.length; i++) {
    var q = await Item.find({ item_code: bill.code[i] })
    const x = await Item.findOneAndUpdate(
      { item_code: bill.code[i] },
      { quantity: q[0].quantity - bill.qty[i] }
    )
    bill_items.push({
      item_code: bill.code[i],
      name: q[0].item_name,
      quantity: bill.qty[i],
      unit_price: bill.price[i],
    })
    const sell = new Sales({
      item_code: bill.code[i],
      item_name: q[0].item_name,
      unit_price: bill.price[i],
      quantity: bill.qty[i],
      date: date,
    })
    await sell.save()
    console.log(q)
  }

  const new_bill = new Bill({
    items: bill_items,
    total_cost: bill.sub_total,
    date: bill.date,
  })
  await new_bill.save()

  bill.id = await Bill.countDocuments()
  bill.bill_items = bill_items
  res.render('print_bill', { bill })
})

app.get('/print', isLoggedIn, (req, res) => {
  if (res.locals.currentUser.user_type != 'Clerk') {
    req.flash('error', 'Only Sales ClerTOOLSk is authorized for this action')
    res.redirect('/welcome')
  }
  res.render('print_bill')
})

//inventory portion

app.get('/inventory', isLoggedIn, async (req, res) => {
  if (res.locals.currentUser.user_type == 'Clerk') {
    req.flash('error', 'You are not authorized for this action')
    res.redirect('/welcome')
  }
  const allDetails = await Item.find({})
  console.log(allDetails)
  res.render('inventory', { details: allDetails })
})

app.post('/add', isLoggedIn, async (req, res) => {
  newitem = req.body
  const item = new Item({
    item_name: newitem.i1,
    item_code: (await Item.countDocuments()) + 1,
    quantity: newitem.i4,
    unit_price: newitem.i3,
    description: newitem.i2,
  })
  await item.save()
  const allDetails = await Item.find({})
  res.render('inventory', { details: allDetails })
})

app.post('/updateItems', isLoggedIn, async (req, res) => {
  newitem = req.body
  const x = await Item.findOneAndUpdate(
    { item_code: parseInt(newitem.i1) },
    { unit_price: newitem.i3, quantity: newitem.i4 }
  )
  const allDetails = await Item.find({})
  res.render('inventory', { details: allDetails })
})

app.listen(3000, () => {
  console.log('Listening on port 3000!!..')
})
