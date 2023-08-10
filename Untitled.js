const express = require("express");
const path = require("path");

const app = express();
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dbPath = path.join(__dirname, "twitterClone.db");

app.use(express.json());
let db = null;

const inatializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3006, () => {
      console.log("Server Running at http://localhost:3006/");
    });
  } catch (e) {
    console.log(`DB Error:${e.message}`);
    process.exit(1);
  }
};
inatializeDBAndServer();

//AuthenticateToken
const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

const validatePassword = (password) => {
  return password.length > 6;
};

//API-1 TOKEN, Path: /register/, Method: POST:
app.post("/register/", async (request, response) => {
  const { userId, username, name, password, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const databaseUser = await db.get(selectUserQuery);

  if (databaseUser === undefined) {
    const createUserQuery = `
     INSERT INTO
      user (username, name, password, gender)
     VALUES
      (
       '${username}',
       '${name}',
       '${hashedPassword}',
       '${gender}'
      );`;
    if (validatePassword(password)) {
      await db.run(createUserQuery);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// API 2, Path: /login/, Method: POST:
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// API 3
// Path: /user/tweets/feed/
// Method: GET
// Description: Returns the latest tweets of people whom the user follows. Return 4 tweets at a time

const tweetResponse = (dbObject) => ({
  username: dbObject.username,
  tweet: dbObject.tweet,
  dateTime: dbObject.date_time,
});

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const latestTweets = await db.all(`SELECT 
  tweet.tweet_id, 
  tweet.user_id, 
  user.username, 
  tweet.tweet, 
  tweet.date_time
FROM 
follower 
INNER JOIN tweet ON tweet.user_id = follower.following_user_id
INNER JOIN user ON follower.following_user_id = user.user_id 
        WHERE follower.follower_user_id= 
        (SELECT user_id FROM user WHERE username = '${request.username}')
        ORDER BY tweet.date_time DESC 
        LIMIT 4;`);

  response.send(latestTweets.map((item) => tweetResponse(item)));
});

// API 4
// Path: /user/following/
// Method: GET
// Description: Returns the list of all names of people whom the user follows

app.get("/user/following/", authenticateToken, async (request, response) => {
  const following = `SELECT user.name FROM follower INNER JOIN user ON follower.following_user_id = user.user_id
                         WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}');`;
  const responseResult = await db.all(following);
  response.send(responseResult);
});

// API 5
// Path: /user/followers/
// Method: GET
// Description: Returns the list of all names of people who follows the user:

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const followers = `
  SELECT 
    user.name 
      FROM 
  follower INNER JOIN user ON follower.follower_user_id = user.user_id
  WHERE follower.following_user_id = 
  (SELECT user_id FROM user WHERE username = '${request.username}');`;
  const responseQuery = await db.all(followers);
  response.send(responseQuery);
});

// follows invalid request
const followsWare = async (request, response, next) => {
  const { tweetId } = request.params;
  let isFollowing = await db.get(`
  SELECT * FROM follower 
  WHERE follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}')
  and 
  following_user_id = (SELECT user.user_id FROM tweet NATURAL JOIN user WHERE tweet_id = '${tweetId}');
  `);
  if (isFollowing === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};
// API 6
// Path: /tweets/:tweetId/
// Method: GET
// Description:If the user requests a tweet other than the users he is following
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  followsWare,
  async (request, response) => {
    const { tweetId } = request.params;
    const { tweet, date_time } = await db.get(
      `SELECT tweet, date_time FROM tweet WHERE tweet_id = '${tweetId}';`
    );
    const { likes } = await db.get(
      `SELECT count(like_id) AS likes FROM like WHERE tweet_id = '${tweetId}';`
    );
    const { replies } = await db.get(
      `SELECT count(reply_id) as replies FROM reply WHERE tweet_id = '${tweetId}';`
    );
    response.send({ tweet, likes, replies, date_time: date_time });
  }
);

module.exports = app;
