import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import fs from "fs";
import dotenv from "dotenv";
import session from "express-session";
import RedisStore from "connect-redis";
import Redis from "ioredis";
import * as EmailValidator from "email-validator";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";
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
var chatHistory = [];
app.use(bodyParser.urlencoded({ extended: true }));

const client = new Redis(process.env.REDIS_URL);
const store = new RedisStore({ client });
app.use(express.json());
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
const checkPassword = async (email, password) => {
  const result = await db.query(
    "SELECT (password IS NOT NULL AND password = $1) AS are_equal FROM users WHERE email = $2;",
    [password, email]
  );
  return result.rows[0].are_equal;
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
const getUserName = async (id) => {
  const result = await db.query("SELECT name FROM users WHERE id = $1", [id]);
  return result.rows[0].name;
};
const getUserDetails = async (id) => {
  var allBlogs = await db.query("SELECT post FROM blogpost WHERE uid = $1", [
    id,
  ]);
  var pubBlogs = await db.query(
    "SELECT post FROM blogpost WHERE uid = $1 AND private = 'FALSE'",
    [id]
  );
  var priBlogs = await db.query(
    "SELECT post FROM blogpost WHERE uid = $1 AND private = 'TRUE'",
    [id]
  );
  allBlogs = allBlogs.rows.length;
  priBlogs = priBlogs.rows.length;
  pubBlogs = pubBlogs.rows.length;
  return [allBlogs, priBlogs, pubBlogs];
};
app.get("/", (req, res) => {
  res.render("index.ejs", { userid: req.session.userid });
});
app.get("/login", redirectHome, (req, res) => {
  res.render("login.ejs");
});
app.get("/userLogin", redirectHome, (req, res) => {
  res.render("login.ejs", { userLogin: true });
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
    res.render("login.ejs", { err: err, userLogin: true });
  } else {
    const check = await checkPassword(email, pass);
    if (check) {
      const id = await db.query(
        "SELECT id FROM users WHERE email = $1 AND password = $2",
        [email, pass]
      );
      req.session.userid = id.rows[0].id;
      res.redirect("/");
    } else {
      const err = "Incorrect Password";
      res.render("login.ejs", { err: err, userLogin: true });
    }
  }
});

app.get("/profile", redirectLogin, async (req, res) => {
  const userName = await getUserName(req.session.userid);
  const [all, pub, pri] = await getUserDetails(req.session.userid);
  res.render("profile.ejs", {
    userName: userName,
    allBlog: all,
    publicBlog: pub,
    privateBlog: pri,
  });
});

app.get("/chatbot", redirectLogin, (req, res) => {
  res.render("chatbox.ejs", { userid: req.session.userid });
  chatHistory = [];
  const textInstruction = "Always reply in an Normal text, no bold, no nothing";
const SYSTEM_PROMPT = 
  "You are a chatbot specializing in book reviews, author insights, and literary recommendations. Only answer questions related to books, authors, or literary topics. If a question is unrelated, politely say: 'Sorry, I can only assist with books, authors, and literary reviews. Please feel free to ask about those!'. If asked who made you, politely reply with: 'I am created with passion and powered by Google.' Do not suggest searching anywhere else for book or author-related reviews. Answer efficiently: 'Can you recommend a book on [genre/topic]?', 'What are some popular books by [author]?', 'What is the summary/review of [book title]?', 'Tell me about the author [name].', 'What are some similar books to [book title]?', 'What books are trending in [genre]?'";
chatHistory.push(
  { role: "SYSTEM", message: SYSTEM_PROMPT },
  { role: "SYSTEM-TEXT-FORMAT", message: textInstruction }
);
});

  app.post("/chat", redirectLogin, async (req, res) => {
  const query = req.body.query; 
  const genAI = new GoogleGenerativeAI(
    process.env.GEMINI_API_KEY
  );
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  chatHistory.push({role:'User', message:query});
  chatHistory = await JSON.stringify(chatHistory);
  const result = await model.generateContent(chatHistory);
  chatHistory = await JSON.parse(chatHistory);
  chatHistory.push({role:"Bot",message:result.response.text()});
  res.send(JSON.stringify(result.response.text()));
});

app.post("/search", redirectLogin, async (req,res) => {
  const {query} = req.body;
  const response = await axios.get(`https://www.googleapis.com/books/v1/volumes`, {
    params: {
      q: query,
      key: process.env.BOOK_API_KEY,
      maxResults: 40
    }
  });
  const data = response.data;
  res.render("bookView.ejs", {data: data, userid: req.session.userid});
});

app.post("/view/:id", async (req,res) => {
  const id = req.params.id;
  const response = await axios.get(`https://www.googleapis.com/books/v1/volumes/${id}`, {
    params: {
      key: process.env.BOOK_API_KEY,
    }
  });
  console.log(response.data);
  res.render("views.ejs", { userid: req.session.userid, data : response.data });
})

app.listen(port, () => {
  console.log(`Server active on port : ${port}`);
});
