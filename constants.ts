
import { Plan, AgentJob, User } from './types';

export const PLANS: Plan[] = [
  {
    id: 'dev',
    name: 'Developer Mode',
    price: 0,
    postLimit: 99,
    features: ['Unlimited everything', 'Full AI access', 'Dev Debugging enabled'],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 19,
    postLimit: 3,
    features: ['3 posts/week', 'Text only', 'Single topic', 'Fixed schedule', 'Basic Analytics'],
  },
  {
    id: 'professional',
    name: 'Professional',
    price: 39,
    postLimit: 5,
    features: ['5 posts/week', 'Text + Image', 'Multiple topics', 'Custom schedule', 'Engagement AI'],
  },
  {
    id: 'brand-pro',
    name: 'Personal Brand Pro',
    price: 79,
    postLimit: 7,
    features: ['Daily posts', 'All formats', 'Tone memory', 'Best-time AI', 'Priority Support'],
  },
];

export const MOCK_USER: User = {
  id: 'u_123',
  name: 'Alex Johnson (Dev)',
  email: 'alex@example.com',
  plan: 'dev', // Defaulting to dev for full access during development
  linkedInConnected: true,
  role: 'DevOps Engineer',
  skills: ['Kubernetes', 'AWS', 'CI/CD', 'Terraform'],
  topics: ['Cloud Architecture', 'DevOps Trends', 'Career Growth'],
  schedule: [
    { day: 'Monday', time: '09:00' },
    { day: 'Wednesday', time: '09:00' },
    { day: 'Friday', time: '10:00' },
  ],
};

export const MOCK_JOBS: AgentJob[] = [
  {
    id: 'j_1',
    userId: 'u_123',
    scheduledTime: new Date(Date.now() + 86400000).toISOString(),
    status: 'scheduled',
    topic: 'Cloud Architecture',
    type: 'text',
  },
  {
    id: 'j_2',
    userId: 'u_123',
    scheduledTime: new Date(Date.now() - 3600000).toISOString(),
    status: 'posted',
    topic: 'DevOps Trends',
    type: 'image',
    generatedContent: 'Just deployed a new cluster! #k8s #cloud',
    linkedInPostId: 'li_share_999',
  },
  {
    id: 'j_3',
    userId: 'u_123',
    scheduledTime: new Date(Date.now() - 172800000).toISOString(),
    status: 'failed',
    topic: 'Career Growth',
    type: 'text',
    error: 'LinkedIn API Token Expired',
  },
  {
    id: 'j_4',
    userId: 'u_123',
    scheduledTime: new Date(Date.now() - 259200000).toISOString(),
    status: 'posted',
    topic: 'Terraform Tips',
    type: 'carousel',
  },
];
