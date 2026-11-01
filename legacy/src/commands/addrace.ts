import { randomUUID } from "node:crypto";
import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { db } from "../database";

export async function handleAddRace(interaction: ChatInputCommandInteraction) {
  const raceName = interaction.options.getString("name", true);
  const description = interaction.options.getString("description");

  // Check if race already exists
  const existing = db.query("SELECT id FROM races WHERE name = ?").get(raceName) as { id: string } | null;
  
  if (existing) {
    await interaction.reply({ 
      embeds: [new EmbedBuilder()
        .setTitle("Race Already Exists")
        .setDescription(`A race named **${raceName}** already exists!`)
        .setColor(0xff0000)
      ],
      ephemeral: true 
    });
    return;
  }

  const raceId = randomUUID();
  const stmt = db.prepare(
    "INSERT INTO races (id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  stmt.run(raceId, raceName, description || null, interaction.user.id, Date.now());

  const embed = new EmbedBuilder()
    .setTitle("✅ Race Added")
    .setColor(0x00ff00)
    .addFields(
      { name: "Race Name", value: raceName, inline: true },
      { name: "Race ID", value: raceId, inline: true }
    );

  if (description) {
    embed.addFields({ name: "Description", value: description, inline: false });
  }

  await interaction.reply({ embeds: [embed] });
}
