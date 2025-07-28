import type { Request, Response } from 'express';
import { getSupportIssuesCollection } from '../db';
import nodemailer from 'nodemailer';

// Configure nodemailer transporter (replace with real credentials)
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', // e.g., smtp.gmail.com
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: 'arpitchaudharycode@gmail.com', // your company email
    pass: 'yutb hnmw pfpn issh'
  },
});

export async function submitSupportIssue(req: Request, res: Response) {
  const { type, description, email } = req.body;
  if (!type || !description || !email) {
    return res.status(400).json({ message: 'Type, description, and email are required.' });
  }
  try {
    const supportIssues = getSupportIssuesCollection();
    await supportIssues.insertOne({
      type,
      description,
      email,
      createdAt: new Date(),
    });

    console.log('Support request will be sent from user email:', email);
    // Send email notification
    await transporter.sendMail({
      from: 'arpitchaudharycode@gmail.com', // authenticated Gmail
      to: 'arpitchaudharycode@gmail.com',   // support inbox
      replyTo: email,                       // user's email for replies
      subject: `New Support Issue: ${type}`,
      text: `Hello Support Team,\n\nYou have received a new support request.\n\n-----------------------------\nIssue Type:   ${type}\n-----------------------------\n\nDescription:\n${description}\n\n-----------------------------\nSubmitted by: ${email}\nDate:         ${new Date().toLocaleString()}\n-----------------------------\n\nPlease respond to the user by replying to this email.\n\nBest regards,\nYour Support Bot`,
    });

    res.status(201).json({ message: 'Support issue submitted successfully.' });
  } catch (error) {
    console.error('Error in submitSupportIssue:', error);
    res.status(500).json({ message: 'Failed to submit support issue.' });
  }
} 