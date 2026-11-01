import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { db } from "../database";

export async function handleListRace(interaction: ChatInputCommandInteraction) {
  const races = db.query(`
    SELECT 
      r.id,
      r.name,
      r.description,
      COUNT(t.id) as time_count
    FROM races r
    LEFT JOIN times t ON r.id = t.race_id
    GROUP BY r.id, r.name, r.description
    ORDER BY r.created_at DESC
  `).all() as Array<{
    id: string;
    name: string;
    description: string | null;
    time_count: number;
  }>;

  if (races.length === 0) {
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle("No Races Found")
        .setDescription("No races have been created yet. Use `/addrace` to create one!")
        .setColor(0xff9900)
      ],
      ephemeral: true
    });
    return;
  }

  const raceList = races.map((race, index) => {
    let raceInfo = `**${index + 1}. ${race.name}**`;
    if (race.description) {
      raceInfo += `\n${race.description}`;
    }
    raceInfo += `\n📊 Times recorded: ${race.time_count}`;
    return raceInfo;
  }).join("\n\n");

  const embed = new EmbedBuilder()
    .setTitle("🏁 Available Races")
    .setDescription(raceList)
    .setColor(0x3498db)
    .setFooter({ text: `Total races: ${races.length}` });

  await interaction.reply({ embeds: [embed] });
}
