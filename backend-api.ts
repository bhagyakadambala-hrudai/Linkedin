/**
 * AUTO-LINK AI: BACKEND PRODUCTION REFERENCE
 * This file contains implementation details for the Node.js/Express backend.
 */

import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';

const app = express();
// Fix: Added 'as any' cast to express.json() to resolve TypeScript overload resolution error (NextHandleFunction vs PathParams)
app.use(express.json() as any);

// Environment Variables
const MAKE_API_KEY = process.env.MAKE_API_KEY;
const MAKE_SCENARIO_ID = process.env.MAKE_SCENARIO_ID; // The specific scenario for posting
const ai = new GoogleGenerativeAI(process.env.API_KEY || '');

cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_NAME, 
  api_key: process.env.CLOUDINARY_KEY, 
  api_secret: process.env.CLOUDINARY_SECRET 
});

/**
 * DATABASE STRUCTURE (Mongoose Reference)
 */
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  schedule: [{
    day: { type: String, enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
    time: String // Format "HH:mm"
  }],
  makeScenarioId: String,
  agentActive: Boolean
});

/**
 * HELPER: Map Days to Make.com numeric format (1=Mon, 7=Sun)
 */
const mapDaysToMake = (schedule: { day: string }[]) => {
  const dayMap: Record<string, number> = {
    'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4,
    'Friday': 5, 'Saturday': 6, 'Sunday': 7
  };
  // Get unique days
  const days = Array.from(new Set(schedule.map(s => dayMap[s.day])));
  return days.sort();
};

/**
 * MAKE.COM API CALL: Sync Scheduling
 */
const syncMakeScenarioSchedule = async (schedule: any[]) => {
  if (!MAKE_API_KEY || !MAKE_SCENARIO_ID) {
    console.error("Make.com credentials missing");
    return;
  }

  // Make standard scheduler usually takes one time for multiple days.
  // For complex multi-time schedules, you might use 'cron' type.
  // Here we use the 'days_of_week' type as requested for the common Mon/Wed/Fri use case.
  const days = mapDaysToMake(schedule);
  const executionTime = schedule[0]?.time || "09:00"; 

  const makePayload = {
    type: "days_of_week",
    interval: 1, // Every week
    days: days,
    time: executionTime
  };

  try {
    const response = await fetch(`https://api.make.com/v2/scenarios/${MAKE_SCENARIO_ID}/scheduling`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Token ${MAKE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(makePayload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Make.com API Error: ${JSON.stringify(errorData)}`);
    }

    console.log(`Successfully synced schedule with Make.com for scenario ${MAKE_SCENARIO_ID}`);
    return true;
  } catch (error) {
    console.error("Failed to sync with Make.com:", error);
    throw error;
  }
};

/**
 * POST /api/save-schedule
 * Saves to DB and triggers Make.com sync
 */
app.post('/api/save-schedule', async (req, res) => {
  try {
    const { schedule } = req.body;
    
    if (!schedule || !Array.isArray(schedule)) {
      return res.status(400).json({ error: 'Invalid schedule format' });
    }

    // 1. Save to Database
    // In production: await User.findByIdAndUpdate(req.user.id, { schedule });
    console.log("Saving schedule to Database...", schedule);

    // 2. Sync with Make.com
    await syncMakeScenarioSchedule(schedule);

    res.json({ success: true, message: 'Schedule saved and synced with automation engine' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// ... Existing endpoints (upload-resume, get-settings, etc.) ...

app.listen(3000, () => console.log('Backend listening on port 3000'));