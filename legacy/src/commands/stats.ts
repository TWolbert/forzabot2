import { ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from "discord.js";
import { formatCurrency } from "../utils";
import { db } from "../database";

export async function handleStats(interaction: ChatInputCommandInteraction) {
  const user = interaction.options.getUser("player");

  if (!user) {
    // Show leaderboard
    const leaderboardData = db.query(`
      SELECT p.id, p.username, p.display_name, COUNT(*) as wins
      FROM rounds r
      JOIN players p ON r.winner_id = p.id
      WHERE r.status = 'finished'
      GROUP BY p.id
      ORDER BY wins DESC
      LIMIT 10
    `).all() as Array<{ id: string; username: string; display_name: string; wins: number }>;

    if (leaderboardData.length === 0) {
      await interaction.reply({ content: "No finished games yet!", ephemeral: true });
      return;
    }

    const leaderboardText = leaderboardData.map((player, index) => {
      const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
      return `${medal} <@${player.id}> - **${player.wins} win${player.wins !== 1 ? 's' : ''}**`;
    }).join("\n");

    const embed = new EmbedBuilder()
      .setTitle("🏆 Leaderboard")
      .setDescription(leaderboardText)
      .setColor(0xffd700);

    await interaction.reply({ embeds: [embed] });
  } else {
    // Show individual player stats
    const playerId = user.id;

    // Get total games played
    const gamesPlayed = db.query(`
      SELECT COUNT(*) as count
      FROM round_players
      WHERE player_id = ?
    `).get(playerId) as { count: number };

    // Get wins
    const wins = db.query(`
      SELECT COUNT(*) as count
      FROM rounds
      WHERE winner_id = ? AND status = 'finished'
    `).get(playerId) as { count: number };

    // Get all races for this player
    const playerRaces = db.query(`
      SELECT r.id, r.class, r.value, r.race_type, r.year, r.winner_id, r.created_at,
             cc.car_name
      FROM rounds r
      JOIN round_players rp ON r.id = rp.round_id
      LEFT JOIN car_choices cc ON r.id = cc.round_id AND cc.player_id = ?
      WHERE rp.player_id = ? AND r.status = 'finished'
      ORDER BY r.created_at DESC
    `).all(playerId, playerId) as Array<{
      id: string;
      class: string;
      value: number;
      race_type: string;
      year: number | null;
      winner_id: string | null;
      created_at: number;
      car_name: string | null;
    }>;

    if (gamesPlayed.count === 0) {
      await interaction.reply({ content: `<@${playerId}> hasn't played any games yet!`, ephemeral: true });
      return;
    }

    let currentRaceIndex = 0;

    const createStatsEmbed = (raceIndex: number) => {
      const winRate = gamesPlayed.count > 0 ? ((wins.count / gamesPlayed.count) * 100).toFixed(1) : "0.0";

      const embed = new EmbedBuilder()
        .setTitle(`📊 Stats for ${user.displayName || user.username}`)
        .setColor(0x3498db)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: "Games Played", value: gamesPlayed.count.toString(), inline: true },
          { name: "Wins", value: wins.count.toString(), inline: true },
          { name: "Win Rate", value: `${winRate}%`, inline: true }
        );

      if (playerRaces.length > 0 && raceIndex >= 0 && raceIndex < playerRaces.length) {
        const race = playerRaces[raceIndex];
        if (!race) return embed;
        
        const isWinner = race.winner_id === playerId;
        const raceDate = new Date(race.created_at).toLocaleDateString();

        embed.addFields(
          { name: "\u200b", value: `**Race ${raceIndex + 1} of ${playerRaces.length}**`, inline: false },
          { name: "Class", value: race.class, inline: true },
          { name: "Value", value: formatCurrency(race.value), inline: true },
          { name: "Race Type", value: race.race_type, inline: true }
        );

        if (race.year) {
          embed.addFields({ name: "Year", value: race.year.toString(), inline: true });
        }

        embed.addFields(
          { name: "Car", value: race.car_name || "No car selected", inline: true },
          { name: "Result", value: isWinner ? "🏆 Won" : "Lost", inline: true },
          { name: "Date", value: raceDate, inline: true }
        );

        embed.setFooter({ text: `Round ID: ${race.id}` });
      }

      return embed;
    };

    const createButtons = (raceIndex: number) => {
      return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`stats_prev_${playerId}`)
          .setLabel("◀ Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(raceIndex <= 0 || playerRaces.length === 0),
        new ButtonBuilder()
          .setCustomId(`stats_next_${playerId}`)
          .setLabel("Next ▶")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(raceIndex >= playerRaces.length - 1 || playerRaces.length === 0)
      );
    };

    const embed = createStatsEmbed(currentRaceIndex);
    const row = createButtons(currentRaceIndex);

    const response = await interaction.reply({
      embeds: [embed],
      components: playerRaces.length > 0 ? [row] : [],
    });

    if (playerRaces.length > 0) {
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300_000,
      });

      collector.on("collect", async (i) => {
        if (!i.customId.includes(playerId)) {
          await i.reply({ content: "This isn't your stats view!", ephemeral: true });
          return;
        }

        if (i.customId === `stats_next_${playerId}`) {
          currentRaceIndex = Math.min(currentRaceIndex + 1, playerRaces.length - 1);
        } else if (i.customId === `stats_prev_${playerId}`) {
          currentRaceIndex = Math.max(currentRaceIndex - 1, 0);
        }

        const newEmbed = createStatsEmbed(currentRaceIndex);
        const newRow = createButtons(currentRaceIndex);
        await i.update({ embeds: [newEmbed], components: [newRow] });
      });
    }
  }
}
