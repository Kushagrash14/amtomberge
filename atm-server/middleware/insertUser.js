import userModel from "../db/modules/auth-models/user.model.js";

let seeded = false;
export const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "software.2040@pgel.in").trim().toLowerCase();

const insertUser = async () => {
  if (seeded) return;

  try {
    const superAdmin = await userModel.findOneAndUpdate(
      { email: SUPER_ADMIN_EMAIL },
      {
        $set: { role: "superadmin" },
        $setOnInsert: {
          username: "superadmin",
          name: "Super Admin",
          email: SUPER_ADMIN_EMAIL,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    seeded = true;
    console.log("Super admin ready:", superAdmin.email);
  } catch (error) {
    console.error("Error inserting user:", error);
  }
};

export default insertUser;
