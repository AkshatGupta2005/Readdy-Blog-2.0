import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import fs from "fs";
import dotenv from "dotenv";
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

app.get("/", (req, res) => {
  res.render("index.ejs");
});
app.get("/login", (req, res) => {
  res.render("login.ejs");
});
app.listen(port, () => {
  console.log(`Server active on port : ${port}`);
});
