"use client";
import { createContext } from "react";

// The signed-in user's name, offered as the default "doctor" / "performed by" in the patient file's add forms.
export const CurrentUserName = createContext("");
