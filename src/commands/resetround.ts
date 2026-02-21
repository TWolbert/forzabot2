import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { db } from "../database";
import { pickRandom } from "../utils";

export async function handleResetRound(interaction: ChatInputCommandInteraction) {
  // Get all active rounds
  const activeRounds = db.query(
    "SELECT * FROM rounds WHERE status = 'active'"
  ).all() as Array<{ id: string; class: string; value: number; race_type: string; year: number | null; created_by: string }>;

  if (activeRounds.length === 0) {
    await interaction.reply({ content: "No active rounds to reset.", ephemeral: true });
    return;
  }

  // Track reset results
  const resetResults = [];
  const updateStmt = db.prepare("UPDATE rounds SET status = 'finished', winner_id = ? WHERE id = ?");

  for (const round of activeRounds) {
    // Get all players in this round
    const roundPlayers = db.query(
      "SELECT p.id, p.display_name, p.username FROM players p JOIN round_players rp ON p.id = rp.player_id WHERE rp.round_id = ?"
    ).all(round.id) as Array<{ id: string; display_name: string; username: string }>;

    if (roundPlayers.length === 0) {
      continue;
    }

    // Pick a random winner
    const winner = pickRandom(roundPlayers);
    
    // Update round with winner and set status to finished
    updateStmt.run(winner.id, round.id);

    resetResults.push({
      roundId: round.id,
      class: round.class,
      value: round.value,
      raceType: round.race_type,
      winner: winner.display_name || winner.username,
    });
  }

  // Build result embed
  const resultEmbed = new EmbedBuilder()
    .setTitle("⚡ Rounds Reset")
    .setColor(0xff6b6b)
    .setDescription(`Finished **${resetResults.length}** active round(s) with random winners:`);

  for (const result of resetResults) {
    const roundInfo = `**${result.class}** • ${result.raceType}`;
    const winnerInfo = `Winner: ${result.winner}`;
    resultEmbed.addFields({ name: roundInfo, value: winnerInfo, inline: false });
  }

  resultEmbed.setFooter({ text: "Server has been recovered from reboot" });

  await interaction.reply({ embeds: [resultEmbed] });
}
