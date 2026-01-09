# Rupert - Discord Bot with Personality

Rupert is a Discord bot powered by Claude AI that acts like a casual friend in your group chat. He occasionally chimes in with opinions and always responds when mentioned.

## Features

- **Natural Conversations**: Powered by Claude 3.5 Haiku for fast, cost-effective responses
- **Non-Spammy**: Configurable random reply chance (default 8%)
- **Always Responsive**: Replies when @mentioned
- **Context Aware**: Remembers recent conversation history
- **Silence Command**: `!rupert_silence` makes Rupert stop talking until the next day
- **Personality**: Casual, friendly, and opinionated like a real person

## Setup

### Prerequisites

- Node.js 18+ installed
- A Discord bot token ([Get one here](https://discord.com/developers/applications))
- An Anthropic API key ([Get one here](https://console.anthropic.com/))

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd rupert
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file from the example:
```bash
cp .env.example .env
```

4. Edit `.env` and add your tokens:
```env
DISCORD_TOKEN=your_discord_token_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
RANDOM_REPLY_CHANCE=8
CONTEXT_MESSAGE_LIMIT=15
```

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and add a bot
3. Enable these Privileged Gateway Intents:
   - MESSAGE CONTENT INTENT
   - GUILD MESSAGES
4. Copy the bot token to your `.env` file
5. Invite the bot to your server using OAuth2 URL Generator:
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Read Messages/View Channels`, `Read Message History`

## Usage

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

## Commands

- `!rupert_silence` - Makes Rupert stop responding until the next day (resets at midnight)

## Configuration

Edit your `.env` file to customize Rupert:

- `RANDOM_REPLY_CHANCE` (0-100): Percentage chance Rupert will randomly reply to a message (default: 8)
- `CONTEXT_MESSAGE_LIMIT`: Number of recent messages to remember for context (default: 15)

## How It Works

Rupert listens to all messages in channels he has access to:

1. **When mentioned**: Always responds
2. **Random replies**: Has a configurable chance to chime in (default 8%)
3. **Context awareness**: Remembers the last 15 messages in each channel
4. **Personality**: Uses Claude AI with a custom personality prompt to respond naturally

## Cost Considerations

Rupert uses Claude 3.5 Haiku, which is Anthropic's most cost-effective model:
- ~$0.25 per million input tokens
- ~$1.25 per million output tokens

With typical usage (short messages, limited responses), costs should be minimal.

## License

MIT
