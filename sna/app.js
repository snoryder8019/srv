import createError from "http-errors";
import express from "express";
import path from "path";
import cookieParser from "cookie-parser";
import logger from "morgan";
import passport from "passport";
import session from "express-session";
import dotenv from "dotenv";
import { connectDB } from "./plugins/mongo/mongo.js"; // Ensure correct import path

dotenv.config();

const app = express();

// Middleware (Session setup before Passport)
app.use(
  session({
    secret: process.env.SESHSEC || "someSecret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true if using HTTPS
  })
);

// 🔹 Ensure database connection before initializing Passport
connectDB()
  .then(() => {
    console.log("🔹 Database connection established, initializing Passport...");
    import("./plugins/passport/passport.js"); // Load Passport config AFTER DB is connected
  })
  .catch((err) => {
    console.error("❌ Failed to connect to database:", err);
    process.exit(1); // Stop the app if DB connection fails
  });

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// View engine setup
app.set("views", path.join(process.cwd(), "views"));
app.set("view engine", "ejs");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(process.cwd(), "public")));

// Routes
import indexRouter from "./routes/index.js";
import usersRouter from "./routes/users.js";

app.use("/", indexRouter);
app.use("/users", usersRouter);

// Error handlers
app.use((req, res, next) => next(createError(404)));
app.use((err, req, res, next) => {
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  res.status(err.status || 500);
  res.render("error");
});

export default app;
