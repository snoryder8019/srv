import mongoose from "mongoose";

const signupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true }
});

export default mongoose.model("Signup", signupSchema);