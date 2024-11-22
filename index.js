import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import fs from "fs";
import dotenv from "dotenv";
import session from "express-session";
import RedisStore from "connect-redis";
import Redis from "ioredis";
import * as EmailValidator from "email-validator";
dotenv.config();
const app = express();
const port = process.env.s_port;
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("./public"));
const db = new pg.Client({
  user: process.env.db_user,
  host: process.env.db_host,
  database: process.env.db_database,
  password: process.env.db_password,
  port: process.env.db_port,
  ssl: {
    ca: fs.readFileSync("./ap-south-1-bundle.pem"),
    rejectUnauthorized: true,
  },
});
db.connect();

db.query("SELECT * FROM users", (err, res) => {
  if (err) {
    console.err("Error : ", err.stack);
  } else {
    console.log(res.rows);
  }
});
app.use(bodyParser.urlencoded({ extended: true }));

const client = new Redis(process.env.REDIS_URL);
const store = new RedisStore({ client });

app.use(
  session({
    store,
    name: "sid",
    saveUninitialized: false,
    resave: false,
    secret: "secret",
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
      sameSite: true,
      secure: false, //change before prod
    },
  })
);
const emailVerification = async (email) => {
  const valid = await EmailValidator.validate(email);
  return valid;
};
const checkEmailExist = async (email) => {
  const result = await db.query(
    "SELECT EXISTS(SELECT 1 FROM users WHERE email = $1);",
    [email]
  );
  return result.rows[0].exists;
};
const redirectHome = (req, res, next) => {
  if (req.session.userid) {
    res.redirect("/");
  } else {
    next();
  }
};
const redirectLogin = (req, res, next) => {
  if (!req.session.userid) {
    res.redirect("/login");
  } else {
    next();
  }
};
const updateNavbar = (req, res, next) => {
  if (req.session.userid) {
    res.render("navbar.ejs", { userLogin: true });
    next();
  } else {
    next();
  }
};
app.get("/", (req, res) => {
  //console.log(req.session);
  //console.log(req.session.userid);
  updateNavbar;
  res.render("index.ejs", { userid: req.session.userid });
});
app.get("/login", redirectHome, (req, res) => {
  res.render("login.ejs");
});
app.get("/userLogin", redirectHome, (req, res) => {
  updateNavbar;
  res.redirect("/");
});
app.post("/register", redirectHome, async (req, res) => {
  var { name, email, pass } = req.body;
  email = email.toLowerCase();
  const result = await emailVerification(email);
  if (result) {
    const checkEmail = await checkEmailExist(email);
    if (!checkEmail) {
      const id = await db.query(
        "INSERT INTO users(name,email,password) values($1,$2,$3) returning id;",
        [name, email, pass]
      );
      req.session.userid = id.rows[0].id;
      updateNavbar;
      res.redirect("/");
    } else {
      const err = "Email Already Exist";
      res.render("login.ejs", { err: err });
    }
  } else {
    const err = "Invalid Email Id";
    res.render("login.ejs", { err: err });
  }
});
app.post("/logUser", async (req, res) => {
  const { email, pass } = req.body;
  const checkEmail = await checkEmailExist(email);
  if (!checkEmail) {
    const err = "Email Id Does Not Exist";
    res.render("login.ejs", { err: err });
  } else {
    const id = await db.query(
      "SELECT id FROM users WHERE email = $1 AND password = $2",
      [email, pass]
    );
    req.session.userid = id.rows[0].id;
    updateNavbar;
    res.redirect("/");
  }
});

app.get("/profile", redirectLogin, (req, res) => {
  res.render("profile.ejs", { userid: req.session.userid });
});

app.listen(port, () => {
  console.log(`Server active on port : ${port}`);
});
