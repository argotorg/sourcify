const dotenv = require("dotenv");
const path = require("path");

// Simple way to load two .env files
dotenv.config({ path: path.join(__dirname, "../.env.test") });
dotenv.config({ path: path.join(__dirname, "../.env") }); // does not override already set values