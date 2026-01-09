import { Client, GatewayIntentBits, Message, TextChannel } from 'discord.js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RANDOM_REPLY_CHANCE = parseInt(process.env.RANDOM_REPLY_CHANCE || '8');
const CONTEXT_MESSAGE_LIMIT = parseInt(process.env.CONTEXT_MESSAGE_LIMIT || '15');

// Validate environment variables
if (!DISCORD_TOKEN || !ANTHROPIC_API_KEY) {
  console.error('Error: Missing required environment variables');
  console.error('Please set the following environment variables:');
  if (!DISCORD_TOKEN) console.error('  - DISCORD_TOKEN');
  if (!ANTHROPIC_API_KEY) console.error('  - ANTHROPIC_API_KEY');
  console.error('\nFor Railway: Set these in your project settings under "Variables"');
  console.error('For local development: Add them to your .env file');
  process.exit(1);
}

console.log('🚀 Starting Rupert Discord bot...');
console.log('✓ Environment variables loaded');

// Initialize clients
const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

// State management
const silencedUntil = new Map<string, number>(); // channelId -> timestamp
const channelMessageHistory = new Map<string, Message[]>(); // channelId -> messages

// Rupert's personality
const RUPERT_SYSTEM_PROMPT = `You are Rupert, a casual guy who's been added to a Discord group chat. You're friendly, have opinions on things, and occasionally chime in with your thoughts like any regular person would in a group chat.

Key traits:
- You're casual and conversational, not formal or robotic
- You have opinions and aren't afraid to share them (but you're not argumentative)
- You use natural language, occasional slang, and sometimes casual grammar
- You're helpful when asked directly, but otherwise just contribute naturally to conversations
- You keep responses relatively short (1-3 sentences usually) unless asked for more detail
- You remember the context of the conversation and stay on topic
- You're friendly and good-natured, never mean or hostile

Respond as Rupert would in this group chat. Don't use excessive emojis. Just be a normal, chill person.`;

// Helper: Check if Rupert is silenced in a channel
function isSilenced(channelId: string): boolean {
  const silenceTime = silencedUntil.get(channelId);
  if (!silenceTime) return false;

  if (Date.now() >= silenceTime) {
    silencedUntil.delete(channelId);
    return false;
  }

  return true;
}

// Helper: Silence Rupert until end of day
function silenceUntilEndOfDay(channelId: string): void {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  silencedUntil.set(channelId, endOfDay.getTime());
}

// Helper: Get recent message history for context
function getMessageHistory(channelId: string): Message[] {
  return channelMessageHistory.get(channelId) || [];
}

// Helper: Add message to history
function addToHistory(message: Message): void {
  const channelId = message.channelId;
  const history = channelMessageHistory.get(channelId) || [];

  history.push(message);

  // Keep only recent messages
  if (history.length > CONTEXT_MESSAGE_LIMIT) {
    history.shift();
  }

  channelMessageHistory.set(channelId, history);
}

// Helper: Build conversation context from history
function buildContextFromHistory(history: Message[], currentMessage: Message): string {
  const messages = [...history, currentMessage];
  return messages
    .map(msg => `${msg.author.username}: ${msg.content}`)
    .join('\n');
}

// Helper: Get response from Claude
async function getClaudeResponse(context: string, isMentioned: boolean): Promise<string> {
  try {
    const userPrompt = isMentioned
      ? `You've been mentioned/asked to respond. Here's the conversation:\n\n${context}\n\nRespond naturally as Rupert:`
      : `Here's the ongoing conversation:\n\n${context}\n\nChime in with a brief, natural response as Rupert:`;

    const message = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022', // Cheap and fast model
      max_tokens: 300,
      system: RUPERT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const response = message.content[0];
    if (response.type === 'text') {
      return response.text;
    }

    return "Sorry, I can't respond right now.";
  } catch (error) {
    console.error('Error getting Claude response:', error);
    return "My brain just glitched for a sec, what were we talking about?";
  }
}

// Handle incoming messages
async function handleMessage(message: Message): Promise<void> {
  // Ignore bot messages and DMs
  if (message.author.bot || !message.guild) return;

  const channelId = message.channelId;

  // Handle silence command
  if (message.content.toLowerCase() === '!rupert_silence') {
    silenceUntilEndOfDay(channelId);
    await message.reply("Alright, I'll keep quiet for the rest of the day 🤐");
    return;
  }

  // Add message to history
  addToHistory(message);

  // Check if silenced
  if (isSilenced(channelId)) return;

  // Check if Rupert is mentioned
  const isMentioned = message.mentions.users.has(discord.user!.id);

  // Decide whether to respond
  let shouldRespond = false;

  if (isMentioned) {
    shouldRespond = true;
  } else {
    // Random chance to respond
    const roll = Math.random() * 100;
    shouldRespond = roll < RANDOM_REPLY_CHANCE;
  }

  if (!shouldRespond) return;

  try {
    // Show typing indicator
    if ('sendTyping' in message.channel) {
      await message.channel.sendTyping();
    }

    // Get conversation context
    const history = getMessageHistory(channelId);
    const context = buildContextFromHistory(history, message);

    // Get Claude's response
    const response = await getClaudeResponse(context, isMentioned);

    // Send response
    await message.reply(response);
  } catch (error) {
    console.error('Error handling message:', error);
  }
}

// Bot ready event
discord.once('ready', () => {
  console.log(`✅ Rupert is online as ${discord.user?.tag}`);
  console.log(`🎲 Random reply chance: ${RANDOM_REPLY_CHANCE}%`);
  console.log(`💬 Context message limit: ${CONTEXT_MESSAGE_LIMIT}`);
});

// Message event
discord.on('messageCreate', handleMessage);

// Error handling
discord.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// Start the bot
discord.login(DISCORD_TOKEN);
