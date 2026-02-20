import { Client, Events, GatewayIntentBits } from "discord.js";
import { initializeDatabase } from "./src/database";
import { handleCommand } from "./src/commands";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Initialize database on startup
initializeDatabase();

// Start API server in background
console.log("Starting API server...");
const apiServer = Bun.spawn(["bun", "run", "web/src/apiserver.ts"], {
  stdio: ["ignore", "inherit", "inherit"],
  cwd: process.cwd(),
});

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  apiServer.kill();
  await client.destroy();
  process.exit(0);
});

client.on(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}!`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await handleCommand(interaction, client);
  } catch (error) {
    console.error("Error handling command:", error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: "An error occurred while executing this command.", ephemeral: true });
    } else {
      await interaction.reply({ content: "An error occurred while executing this command.", ephemeral: true });
    }
  }
});

client.login(process.env.TOKEN!);
