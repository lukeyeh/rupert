import { Client, GatewayIntentBits, Message, TextChannel, REST, Routes, SlashCommandBuilder } from 'discord.js';
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
console.log(`✓ Discord token: ${DISCORD_TOKEN.substring(0, 10)}...`);
console.log(`✓ Anthropic API key: ${ANTHROPIC_API_KEY.substring(0, 10)}...`);

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

// Slash command definitions
const commands = [
  new SlashCommandBuilder()
    .setName('silence')
    .setDescription('Make Rupert stop responding until the next day'),
  new SlashCommandBuilder()
    .setName('unsilence')
    .setDescription('Allow Rupert to start responding again'),
].map(command => command.toJSON());

// Register slash commands with Discord
async function registerCommands() {
  if (!DISCORD_TOKEN) return;

  const rest = new REST().setToken(DISCORD_TOKEN);
  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(discord.user!.id),
      { body: commands },
    );
    console.log('✅ Slash commands registered successfully');
  } catch (error) {
    console.error('❌ Error registering slash commands:', error);
  }
}

// State management
const silencedUntil = new Map<string, number>(); // channelId -> timestamp
const channelMessageHistory = new Map<string, Message[]>(); // channelId -> messages
const lastReplyIndex = new Map<string, number>(); // channelId -> index of last message when Rupert replied

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

CRITICAL RULES:
1. Your response must be PURE DIALOGUE ONLY. Do NOT include:
   - Stage directions or actions (like "ahem", "chimes in", "Rupert says")
   - Asterisks or italics for actions (*does something*)
   - Narrative descriptions
   - Your name before speaking
   - Any greeting prefixes if already in conversation

2. ONLY refer to information that is EXPLICITLY shown in the conversation history provided.
   - DO NOT make up or hallucinate past conversations that aren't shown
   - DO NOT invent topics, messages, or discussions that didn't happen
   - If you don't have enough context, admit it rather than making things up

3. Each response should be FRESH and UNIQUE.
   - Do NOT repeat the same ideas or phrases you may have said before
   - Vary your responses and keep the conversation moving forward
   - If the conversation is going in circles, change the subject or acknowledge it

Start your response immediately with what you want to say. Nothing else.`;

// Helper: Clean response from any stage directions or narrative prefixes
function cleanResponse(text: string): string {
  // Remove common stage direction patterns at the start of the response
  let cleaned = text
    // Remove italicized stage directions like "chimes in casually" or "ahem"
    .replace(/^[\s\n]*\*[^*]+\*[\s\n]*/i, '')
    // Remove patterns like "Rupert says:" or "Rupert:"
    .replace(/^[\s\n]*rupert\s*(says|chimes in|responds)?[\s:]+/i, '')
    // Remove standalone italicized words at the start like "ahem" or "chimes in"
    .replace(/^[\s\n]*(ahem|chimes in casually|chimes in|walks in|enters)[\s\n]+/i, '')
    // Remove markdown italics at the very start
    .replace(/^_([^_]+)_[\s\n]+/, '');

  return cleaned.trim();
}

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

// Helper: Remove silence from a channel
function unsilence(channelId: string): void {
  silencedUntil.delete(channelId);
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
function buildContextFromHistory(channelId: string, history: Message[], currentMessage: Message): string {
  const messages = [...history, currentMessage];

  // Get the index of the last message when Rupert replied
  const lastIndex = lastReplyIndex.get(channelId) ?? -1;

  // Only include messages that came AFTER Rupert's last reply
  const newMessages = lastIndex === -1
    ? messages
    : messages.slice(lastIndex + 1);

  // Filter out bot messages to prevent Rupert from seeing his own responses
  const userMessages = newMessages.filter(msg => !msg.author.bot);

  console.log(`📊 Total messages in history: ${messages.length}`);
  console.log(`📊 Last reply was at index: ${lastIndex}`);
  console.log(`📊 New messages since last reply: ${newMessages.length}`);
  console.log(`📊 User messages (excluding bot): ${userMessages.length}`);

  return userMessages
    .map(msg => `${msg.author.username}: ${msg.content}`)
    .join('\n');
}

// Helper: Get response from Claude
async function getClaudeResponse(context: string, isMentioned: boolean): Promise<string> {
  try {
    console.log('📝 Context being sent to Claude:');
    console.log(context);
    console.log('---');

    const userPrompt = isMentioned
      ? `You've been mentioned/asked to respond. Here's the COMPLETE conversation history - this is ALL the context you have:\n\n${context}\n\nRespond naturally as Rupert. ONLY reference what you see above. Do not make up or imagine other messages.`
      : `Here's the COMPLETE conversation history - this is ALL the context you have:\n\n${context}\n\nChime in with a brief, natural response as Rupert. ONLY reference what you see above.`;

    const message = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307', // Fast and cost-effective model
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
      console.log('✓ Claude response received successfully');
      const cleaned = cleanResponse(response.text);
      console.log(`Original: "${response.text.substring(0, 50)}..."`);
      console.log(`Cleaned: "${cleaned.substring(0, 50)}..."`);
      return cleaned;
    }

    console.warn('⚠️ Claude returned non-text response');
    return "Sorry, I can't respond right now.";
  } catch (error) {
    console.error('❌ Error getting Claude response:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    return "My brain just glitched for a sec, what were we talking about?";
  }
}

// Handle incoming messages
async function handleMessage(message: Message): Promise<void> {
  // Ignore bot messages and DMs
  if (message.author.bot || !message.guild) return;

  const channelId = message.channelId;

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
    const context = buildContextFromHistory(channelId, history, message);

    // Get Claude's response
    const response = await getClaudeResponse(context, isMentioned);

    // Send response
    await message.reply(response);

    // Update the last reply index to current history length
    // This marks where we are in the conversation
    lastReplyIndex.set(channelId, history.length);
    console.log(`✅ Updated last reply index for channel to: ${history.length}`);
  } catch (error) {
    console.error('Error handling message:', error);
  }
}

// Bot ready event
discord.once('ready', async () => {
  console.log(`✅ Rupert is online as ${discord.user?.tag}`);
  console.log(`🎲 Random reply chance: ${RANDOM_REPLY_CHANCE}%`);
  console.log(`💬 Context message limit: ${CONTEXT_MESSAGE_LIMIT}`);
  await registerCommands();
});

// Message event
discord.on('messageCreate', handleMessage);

// Slash command handler
discord.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const channelId = interaction.channelId;

  if (interaction.commandName === 'silence') {
    silenceUntilEndOfDay(channelId);
    await interaction.reply("Alright, I'll keep quiet for the rest of the day 🤐");
  } else if (interaction.commandName === 'unsilence') {
    unsilence(channelId);
    await interaction.reply("Alright, I'm back! What did I miss? 👋");
  }
});

// Error handling
discord.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// Start the bot
discord.login(DISCORD_TOKEN);
