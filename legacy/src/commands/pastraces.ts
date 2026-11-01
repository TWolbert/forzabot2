import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { formatCurrency } from "../utils";
import { db } from "../database";

export async function handlePastRaces(interaction: ChatInputCommandInteraction) {
  const limit = interaction.options.getInteger("limit") || 10;
  const safeLimit = Math.min(Math.max(limit, 1), 25);

  const pastRaces = db.query(`
    SELECT r.id, r.class, r.value, r.race_type, r.year, r.winner_id, r.created_at,
           p.username, p.display_name
    FROM rounds r
    LEFT JOIN players p ON r.winner_id = p.id
    WHERE r.status = 'finished'
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(safeLimit) as Array<{
    id: string;
    class: string;
    value: number;
    race_type: string;
    year: number | null;
    winner_id: string | null;
    created_at: number;
    username: string | null;
    display_name: string | null;
  }>;

  if (pastRaces.length === 0) {
    await interaction.reply({ content: "No finished races yet!", ephemeral: true });
    return;
  }

  const raceList = pastRaces.map((race, index) => {
    const date = new Date(race.created_at).toLocaleDateString();
    const winner = race.winner_id ? `<@${race.winner_id}>` : "No winner";
    return `**${index + 1}.** ${race.class} | ${race.race_type} | Winner: ${winner} | ${date}`;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("🏁 Past Races")
    .setDescription(raceList)
    .setColor(0x9b59b6)
    .setFooter({ text: `Showing ${pastRaces.length} most recent race${pastRaces.length !== 1 ? 's' : ''}` });

  await interaction.reply({ embeds: [embed] });
}
