import userModel from "../db/modules/auth-models/user.model.js";

let seeded = false;

const insertUser = async () => {
  if (seeded) return;

  try {
    const email = "pradeeprajput898989@gmail.com"; // Replace with the email you want to check

    const existingUser = await userModel.findOne({ email });
    if (existingUser) {
      seeded = true;
      console.log("User already exists:", existingUser);
      return 
    }

    const newUser = new userModel({
      username: "pradeep",
      name: "pradeep",
      email: email,
      role: "superadmin",
    });

    await newUser.save();
    seeded = true;
    console.log("New user inserted:", newUser);
  } catch (error) {
    console.error("Error inserting user:", error);
    return
  }
};

export default insertUser;
