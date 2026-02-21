import { ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Client } from "discord.js";
import { formatCurrency, getTopCarImage } from "../utils";
import { db } from "../database";

export async function handleGameStart(interaction: ChatInputCommandInteraction, client: Client) {
  // Get the most recent pending round
  const round = db.query(
    "SELECT * FROM rounds WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1"
  ).get() as { id: string; class: string; value: number; race_type: string; year: number | null; created_by: string } | null;

  if (!round) {
    await interaction.reply({ content: "No pending round found. Please start a round first with `/startround`.", ephemeral: true });
    return;
  }

  // Get players for this round
  const roundPlayers = db.query(
    "SELECT p.id, p.username, p.display_name FROM players p JOIN round_players rp ON p.id = rp.player_id WHERE rp.round_id = ?"
  ).all(round.id) as Array<{ id: string; username: string; display_name: string }>;

  if (roundPlayers.length === 0) {
    await interaction.reply({ content: "No players found for this round.", ephemeral: true });
    return;
  }

  // Get car choices for this round
  const carChoices = db.query(
    "SELECT player_id, car_name FROM car_choices WHERE round_id = ?"
  ).all(round.id) as Array<{ player_id: string; car_name: string }>;

  const carChoiceMap = new Map(carChoices.map(c => [c.player_id, c.car_name]));

  // Build player list with car selections
  const playerList = roundPlayers.map(player => {
    const car = carChoiceMap.get(player.id);
    if (car) {
      return `<@${player.id}> - **${car}**`;
    }
    return `<@${player.id}> - ⚠️ No car selected`;
  }).join("\n");

  // Check if all players have chosen cars
  const allChosen = roundPlayers.every(player => carChoiceMap.has(player.id));

  const embed = new EmbedBuilder()
    .setTitle("🏁 Game Starting!")
    .setColor(allChosen ? 0x00ff00 : 0xffaa00)
    .addFields(
      { name: "Class", value: round.class, inline: true },
      { name: "Value", value: formatCurrency(round.value), inline: true },
      { name: "Race Type", value: round.race_type, inline: true }
    );

  if (round.year) {
    embed.addFields({ name: "Year", value: round.year.toString(), inline: true });
  }

  embed.addFields({ name: "Players & Cars", value: playerList, inline: false });

  if (!allChosen) {
    embed.setDescription("⚠️ Warning: Not all players have selected a car!");
  }

  embed.setFooter({ text: `Round ID: ${round.id}` });

  // Create player embeds with avatars and car images
  const playerEmbeds = await Promise.all(
    roundPlayers.map(async (player) => {
      const car = carChoiceMap.get(player.id);
      
      // Fetch the user to get their avatar
      let avatarUrl: string | undefined;
      try {
        const user = await client.users.fetch(player.id);
        avatarUrl = user.displayAvatarURL({ size: 256 });
        
        // Cache the avatar URL
        if (avatarUrl) {
          const upsertStmt = db.prepare(
            "INSERT INTO discord_avatars (player_id, avatar_url, cached_at) VALUES (?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET avatar_url = ?, cached_at = ?"
          );
          upsertStmt.run(player.id, avatarUrl, Date.now(), avatarUrl, Date.now());
        }
      } catch (e) {
        // Silently fail, avatar just won't be shown
      }
      
      const playerEmbed = new EmbedBuilder()
        .setAuthor({
          name: player.display_name || player.username,
          iconURL: avatarUrl,
        })
        .setColor(0x3498db);

      if (car) {
        playerEmbed.setTitle(car);
        const carImage = await getTopCarImage(car);
        if (carImage) {
          playerEmbed.setThumbnail(carImage);
        }
      } else {
        playerEmbed.setTitle("⚠️ No car selected");
      }

      return playerEmbed;
    })
  );

  // Update round status to active
  const updateStmt = db.prepare("UPDATE rounds SET status = 'active' WHERE id = ?");
  updateStmt.run(round.id);

  // Add finish button
  const finishButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`finish_game_${round.id}`)
      .setLabel("Finish Game")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("🏁")
  );

  // Send main embed and player embeds
  const response = await interaction.reply({ embeds: [embed, ...playerEmbeds], components: [finishButton] });

  // Create collector for finish button
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 3600_000, // 1 hour
  });

  collector.on("collect", async (i) => {
    if (i.customId === `finish_game_${round.id}`) {
      // Only allow the round creator to finish the game
      if (i.user.id !== round.created_by) {
        await i.reply({ content: "Only the person who started this round can finish it!", ephemeral: true });
        return;
      }
      // Create buttons for each player to select as winner
      const winnerButtons: ButtonBuilder[] = roundPlayers.map(player => 
        new ButtonBuilder()
          .setCustomId(`winner_${round.id}_${player.id}`)
          .setLabel(player.display_name || player.username)
          .setStyle(ButtonStyle.Success)
      );

      // Split into rows of 5 buttons max
      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      for (let idx = 0; idx < winnerButtons.length; idx += 5) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          winnerButtons.slice(idx, idx + 5)
        );
        rows.push(row);
      }

      const winnerEmbed = new EmbedBuilder()
        .setTitle("🏆 Select the Winner")
        .setDescription("Choose which player won this round:")
        .setColor(0xffd700);

      await i.update({ embeds: [winnerEmbed], components: rows });
    } else if (i.customId.startsWith(`winner_${round.id}_`)) {
      const winnerId = i.customId.replace(`winner_${round.id}_`, "");
      const winner = roundPlayers.find(p => p.id === winnerId);

      if (!winner) {
        await i.reply({ content: "Error: Winner not found", ephemeral: true });
        return;
      }

      // Update round with winner and set status to finished
      const finishStmt = db.prepare("UPDATE rounds SET status = 'finished', winner_id = ? WHERE id = ?");
      finishStmt.run(winnerId, round.id);

      // Get winner's car
      const winnerCar = carChoiceMap.get(winnerId) || "No car selected";

      // Fetch player avatar and car image
      let playerAvatarUrl: string | undefined;
      let carImageUrl: string | null = null;
      
      try {
        const user = await client.users.fetch(winnerId);
        playerAvatarUrl = user.displayAvatarURL({ size: 256 });
      } catch (e) {
        // Silently fail
      }

      if (winnerCar && winnerCar !== "No car selected") {
        carImageUrl = await getTopCarImage(winnerCar);
      }

      const finalEmbed = new EmbedBuilder()
        .setTitle("🏆 Game Finished!")
        .setDescription(`**Winner: <@${winnerId}>**`)
        .setColor(0xffd700)
        .addFields(
          { name: "Winning Car", value: `**${winnerCar}**`, inline: false },
          { name: "Class", value: round.class, inline: true },
          { name: "Value", value: formatCurrency(round.value), inline: true },
          { name: "Race Type", value: round.race_type, inline: true }
        );

      if (playerAvatarUrl) {
        finalEmbed.setThumbnail(playerAvatarUrl);
      }

      if (carImageUrl) {
        finalEmbed.setImage(carImageUrl);
      }

      finalEmbed.setFooter({ text: `Round ID: ${round.id}` });

      await i.update({ embeds: [finalEmbed], components: [] });
      collector.stop();
    }
  });
}
