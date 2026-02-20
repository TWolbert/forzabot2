import { ChatInputCommandInteraction } from "discord.js";

export async function handlePing(interaction: ChatInputCommandInteraction) {
  await interaction.reply("Pong!");
}

export async function handleForza(interaction: ChatInputCommandInteraction) {
  await interaction.reply("Forza");
}
