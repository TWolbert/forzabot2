import path from "node:path";
import { ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, Client, StringSelectMenuBuilder } from "discord.js";
import { formatCurrency, getTopCarImage, pickRandom } from "../utils";
import { db } from "../database";

const CANDR_ROWS = ["A", "B", "C", "D", "E", "F", "G"] as const;
const CANDR_TILE_INTERVAL_MS = 2 * 60 * 1000;

const formatDuration = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const normalizeCandrTile = (tile: string): string | null => {
  const normalized = tile.trim().toUpperCase();
  const match = normalized.match(/^([A-G])(\d{1,2})$/);
  if (!match) return null;

  const row = match[1];
  const col = Number.parseInt(match[2]!, 10);
  if (!row || Number.isNaN(col) || col < 1 || col > 13) return null;

  return `${row}${col}`;
};

const buildCandrTileRows = (roundId: string) => {
  const allTiles: string[] = [];
  for (const row of CANDR_ROWS) {
    for (let col = 1; col <= 13; col += 1) {
      allTiles.push(`${row}${col}`);
    }
  }

  const chunkSize = 25;
  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];

  for (let i = 0; i < allTiles.length; i += chunkSize) {
    const chunk = allTiles.slice(i, i + chunkSize);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`candr_tile_pick_${roundId}_${Math.floor(i / chunkSize)}`)
      .setPlaceholder(`Select target tile (${i + 1}-${Math.min(i + chunkSize, allTiles.length)})`)
      .addOptions(
        chunk.map((tile) => ({
          label: tile,
          value: tile,
          description: `Set current target to ${tile}`,
        }))
      );

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  }

  return rows;
};

const buildCandrStatusEmbed = (
  roundId: string,
  robberId: string,
  cops: Array<{ id: string; display_name: string; username: string }>,
  currentTile: string | null,
  nextTileDueAt: number | null,
  startedAt: number
) => {
  const now = Date.now();
  const remainingMs = nextTileDueAt ? Math.max(0, nextTileDueAt - now) : 0;
  const elapsed = formatDuration(now - startedAt);

  const embed = new EmbedBuilder()
    .setTitle("🚨 Cops and Robbers Live")
    .setColor(0xcc2b2b)
    .setDescription("Robber must set a new tile every 2 minutes. The active tile is highlighted red on the live page.")
    .addFields(
      { name: "Robber", value: `<@${robberId}>`, inline: true },
      { name: "Current Target Tile", value: currentTile ?? "Not selected yet", inline: true },
      { name: "Next Tile In", value: nextTileDueAt ? formatDuration(remainingMs) : "Ready now", inline: true },
      { name: "Elapsed Time", value: elapsed, inline: true },
      {
        name: "Cops",
        value: cops.map((cop) => `<@${cop.id}>`).join("\n") || "None",
        inline: false,
      }
    )
    .setImage("attachment://candr-map.png")
    .setFooter({ text: `Round ID: ${roundId}` });

  return embed;
};

async function lockBetsForRound(roundId: string) {
  try {
    const port = process.env.DASHBOARD_PORT || '34234'
    const response = await fetch(`http://localhost:${port}/api/bets/lock/${roundId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    if (!response.ok) {
      console.error(`Failed to lock bets for round ${roundId}:`, await response.text())
    }
  } catch (error) {
    console.error(`Error calling lock bets API:`, error)
  }
}

export async function handleGameStart(interaction: ChatInputCommandInteraction, client: Client) {
  // Get the most recent pending round
  const round = db.query(
    "SELECT * FROM rounds WHERE status = 'pending' ORDER BY created_at DESC LIMIT 1"
  ).get() as { id: string; class: string; value: number; race_type: string; year: number | null; created_by: string; restrict_class: number | null } | null;

  if (!round) {
    await interaction.reply({ content: "No pending round found. Please start a round first with `/startround`.", ephemeral: true });
    return;
  }

  const isAllSeries = round.race_type.toLowerCase() === 'all';
  const isCandr = round.race_type.toLowerCase() === 'candr';
  const raceSequence = ['drag', 'circuit', 'rally', 'goliath'];

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
    .setColor(allChosen ? 0x00ff00 : 0xffaa00);

  if (round.restrict_class !== 0) {
    embed.addFields({ name: "Class", value: round.class, inline: true });
  }

  embed.addFields(
    { name: "Value", value: formatCurrency(round.value), inline: true },
    { name: "Race Type", value: round.race_type, inline: true }
  );

  if (isAllSeries) {
    embed.addFields({ name: "Series Race", value: raceSequence[0].toUpperCase(), inline: true });
  }

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
      
      // Fetch the user to get their avatar (already cached from startround)
      let avatarUrl: string | undefined;
      try {
        const user = await client.users.fetch(player.id);
        avatarUrl = user.displayAvatarURL({ size: 256 });
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

  // Lock bets for this round
  await lockBetsForRound(round.id);

  if (isCandr) {
    const robber = pickRandom(roundPlayers);
    const cops = roundPlayers.filter((player) => player.id !== robber.id);
    const startedAt = Date.now();

    db.transaction(() => {
      db.prepare("DELETE FROM candr_player_roles WHERE round_id = ?").run(round.id);
      db.prepare("DELETE FROM candr_state WHERE round_id = ?").run(round.id);

      const roleStmt = db.prepare(
        "INSERT INTO candr_player_roles (round_id, player_id, role, assigned_at) VALUES (?, ?, ?, ?)"
      );

      for (const player of roundPlayers) {
        roleStmt.run(round.id, player.id, player.id === robber.id ? "robber" : "cop", startedAt);
      }

      db.prepare(
        "INSERT INTO candr_state (round_id, robber_player_id, current_tile, previous_tile, started_at, last_tile_at, next_tile_due_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(round.id, robber.id, null, null, startedAt, null, startedAt, null);
    })();

    const mapPath = path.join(process.cwd(), "media", "cops_and_robbers_map.png");
    const mapName = "candr-map.png";

    const finishButtonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`finish_game_${round.id}`)
        .setLabel("Finish Cops and Robbers")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🏁")
    );

    const response = await interaction.reply({
      embeds: [
        buildCandrStatusEmbed(round.id, robber.id, cops, null, startedAt, startedAt),
      ],
      files: [{ attachment: mapPath, name: mapName }],
      components: [finishButtonRow, ...buildCandrTileRows(round.id)],
    });

    const candrCollector = response.createMessageComponentCollector({
      time: 12 * 60 * 60 * 1000,
    });

    candrCollector.on("collect", async (i) => {
      if (i.isButton() && i.customId === `finish_game_${round.id}`) {
        if (i.user.id !== round.created_by) {
          await i.reply({ content: "Only the person who started this round can finish it!", ephemeral: true });
          return;
        }

        const state = db.query(
          "SELECT started_at, current_tile FROM candr_state WHERE round_id = ? LIMIT 1"
        ).get(round.id) as { started_at: number; current_tile: string | null } | null;

        const finishedAt = Date.now();
        const totalTimeMs = Math.max(0, finishedAt - (state?.started_at ?? finishedAt));

        db.transaction(() => {
          db.prepare("UPDATE rounds SET status = 'finished', candr_total_time_ms = ? WHERE id = ?").run(totalTimeMs, round.id);
          db.prepare("UPDATE candr_state SET finished_at = ?, next_tile_due_at = NULL WHERE round_id = ?").run(finishedAt, round.id);
        })();

        const doneEmbed = new EmbedBuilder()
          .setTitle("🚓 Cops and Robbers Finished")
          .setColor(0x2ecc71)
          .setDescription("Round complete. Total C&R time has been registered.")
          .addFields(
            { name: "Total Time", value: formatDuration(totalTimeMs), inline: true },
            { name: "Last Target Tile", value: state?.current_tile ?? "None", inline: true }
          )
          .setFooter({ text: `Round ID: ${round.id}` });

        await i.update({ embeds: [doneEmbed], components: [] });
        candrCollector.stop();
        return;
      }

      if (i.isStringSelectMenu() && i.customId.startsWith(`candr_tile_pick_${round.id}_`)) {
        const state = db.query(
          "SELECT robber_player_id, current_tile, started_at, next_tile_due_at FROM candr_state WHERE round_id = ? LIMIT 1"
        ).get(round.id) as { robber_player_id: string; current_tile: string | null; started_at: number; next_tile_due_at: number | null } | null;

        if (!state) {
          await i.reply({ content: "CANDR state not found for this round.", ephemeral: true });
          return;
        }

        if (i.user.id !== state.robber_player_id) {
          await i.reply({ content: "Only the robber can set the target tile.", ephemeral: true });
          return;
        }

        const selectedTileRaw = i.values[0];
        const selectedTile = selectedTileRaw ? normalizeCandrTile(selectedTileRaw) : null;
        if (!selectedTile) {
          await i.reply({ content: "Invalid tile selected.", ephemeral: true });
          return;
        }

        const now = Date.now();
        const dueAt = state.next_tile_due_at ?? now;
        if (state.current_tile && now < dueAt) {
          await i.reply({
            content: `You must wait ${formatDuration(dueAt - now)} before selecting a new tile.`,
            ephemeral: true,
          });
          return;
        }

        const nextDueAt = now + CANDR_TILE_INTERVAL_MS;
        db.prepare(
          "UPDATE candr_state SET previous_tile = current_tile, current_tile = ?, last_tile_at = ?, next_tile_due_at = ? WHERE round_id = ?"
        ).run(selectedTile, now, nextDueAt, round.id);

        await i.update({
          embeds: [buildCandrStatusEmbed(round.id, state.robber_player_id, cops, selectedTile, nextDueAt, state.started_at)],
          components: [finishButtonRow, ...buildCandrTileRows(round.id)],
        });
      }
    });

    return;
  }

  if (isAllSeries) {
    const scoreStmt = db.prepare(
      "INSERT OR IGNORE INTO round_scores (round_id, player_id, points) VALUES (?, ?, 0)"
    );
    for (const player of roundPlayers) {
      scoreStmt.run(round.id, player.id);
    }
  }

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

  const totalScores = new Map<string, number>();
  const raceResults = new Map<number, { raceType: string; placements: string[]; pointsByPlayer: Map<string, number> }>();
  let activeRaceIndex = 0;
  let lastRacePlacements: string[] = [];
  let sequence = [...raceSequence];
  let currentSelection: { raceType: string; remaining: string[]; placements: string[] } | null = null;

  const getPlayerName = (playerId: string) => {
    const player = roundPlayers.find(p => p.id === playerId);
    return player?.display_name || player?.username || playerId;
  };

  const pointsForPosition = (position: number) => {
    return Math.max(1, roundPlayers.length - position + 1);
  };

  const buildStandingsText = () => {
    const standings = [...totalScores.entries()]
      .sort((a, b) => b[1] - a[1] || getPlayerName(a[0]).localeCompare(getPlayerName(b[0])))
      .map(([playerId, points], index) => `${index + 1}. ${getPlayerName(playerId)} - ${points} pts`);

    return standings.join("\n") || "No scores yet.";
  };

  const persistScores = () => {
    const stmt = db.prepare(
      "INSERT INTO round_scores (round_id, player_id, points) VALUES (?, ?, ?) ON CONFLICT(round_id, player_id) DO UPDATE SET points = ?"
    );
    for (const [playerId, points] of totalScores.entries()) {
      stmt.run(round.id, playerId, points, points);
    }
  };

  const persistRaceResults = (raceIndex: number, raceType: string, placements: string[], pointsByPlayer: Map<string, number>) => {
    db.prepare("DELETE FROM round_race_results WHERE round_id = ? AND race_index = ?").run(round.id, raceIndex);
    const insertStmt = db.prepare(
      "INSERT INTO round_race_results (round_id, race_index, race_type, player_id, position, points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    placements.forEach((playerId, index) => {
      insertStmt.run(round.id, raceIndex, raceType, playerId, index + 1, pointsByPlayer.get(playerId) ?? 0, Date.now());
    });
  };

  const startRaceSelection = async (i: any, raceIndex: number) => {
    const raceType = sequence[raceIndex];
    if (!raceType) return;

    currentSelection = {
      raceType,
      remaining: roundPlayers.map(p => p.id),
      placements: []
    };

    const embed = new EmbedBuilder()
      .setTitle(`Select 1st Place - ${raceType.toUpperCase()}`)
      .setDescription(`Please race the ${raceType.toUpperCase()} race, then pick the finishing order.`)
      .setColor(0xff8c00);

    const buttons = currentSelection.remaining.map(playerId =>
      new ButtonBuilder()
        .setCustomId(`racepick_${round.id}_${playerId}`)
        .setLabel(getPlayerName(playerId))
        .setStyle(ButtonStyle.Primary)
    );

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let idx = 0; idx < buttons.length; idx += 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(idx, idx + 5)));
    }

    await i.update({ embeds: [embed], components: rows });
  };

  const finalizeRace = async (i: any, raceType: string, placements: string[], raceIndex: number) => {
    const pointsByPlayer = new Map<string, number>();
    placements.forEach((playerId, index) => {
      const points = pointsForPosition(index + 1);
      pointsByPlayer.set(playerId, points);
      totalScores.set(playerId, (totalScores.get(playerId) ?? 0) + points);
    });

    raceResults.set(raceIndex, { raceType, placements, pointsByPlayer });
    lastRacePlacements = [...placements];

    persistScores();
    persistRaceResults(raceIndex, raceType, placements, pointsByPlayer);

    const placementsText = placements
      .map((playerId, index) => `${index + 1}. ${getPlayerName(playerId)} (+${pointsByPlayer.get(playerId) ?? 0})`)
      .join("\n");

    const summaryEmbed = new EmbedBuilder()
      .setTitle(`Race Complete: ${raceType.toUpperCase()}`)
      .setDescription(placementsText)
      .addFields({ name: "Standings", value: buildStandingsText() })
      .setColor(0x00ff99);

    const isGoliath = raceType === 'goliath';
    if (isGoliath) {
      const topScore = Math.max(...totalScores.values());
      const topPlayers = [...totalScores.entries()].filter(([, points]) => points === topScore);
      if (topPlayers.length > 1 && !sequence.includes('offroad')) {
        sequence = [...sequence, 'offroad'];
      }
    }

    if (raceIndex < sequence.length - 1) {
      const nextButton = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`race_next_${round.id}`)
          .setLabel("Next Race")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`race_redo_${round.id}`)
          .setLabel("Redo Race")
          .setStyle(ButtonStyle.Secondary)
      );

      await i.update({ embeds: [summaryEmbed], components: [nextButton] });
      return;
    }

    const standings = [...totalScores.entries()].sort((a, b) => {
      const diff = b[1] - a[1];
      if (diff !== 0) return diff;
      const positionA = lastRacePlacements.indexOf(a[0]);
      const positionB = lastRacePlacements.indexOf(b[0]);
      if (positionA !== -1 && positionB !== -1) return positionA - positionB;
      return getPlayerName(a[0]).localeCompare(getPlayerName(b[0]));
    });

    const winnerId = standings[0]?.[0] ?? roundPlayers[0]?.id;
    if (winnerId) {
      db.prepare("UPDATE rounds SET status = 'finished', winner_id = ? WHERE id = ?").run(winnerId, round.id);
      
      // Settle bets and award placement points via API
      try {
        const port = process.env.DASHBOARD_PORT || '34234'
        console.log(`🎯 Settling bets for round ${round.id}...`)
        const settleRes = await fetch(`http://localhost:${port}/api/bets/settle/${round.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        if (!settleRes.ok) {
          console.error(`❌ Bet settlement failed: ${settleRes.status} ${settleRes.statusText}`)
        } else {
          console.log(`✓ Bets settled for round ${round.id}`)
        }
        
        console.log(`🏆 Awarding placement points for round ${round.id}...`)
        const awardRes = await fetch(`http://localhost:${port}/api/bets/award-placement/${round.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        if (!awardRes.ok) {
          console.error(`❌ Placement award failed: ${awardRes.status} ${awardRes.statusText}`)
        } else {
          console.log(`✓ Placement points awarded for round ${round.id}`)
        }

        // Log points history for each player after round is complete
        console.log(`📊 Logging points history for round ${round.id}...`)
        const logRes = await fetch(`http://localhost:${port}/api/points-history/log/${round.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        if (!logRes.ok) {
          console.error(`❌ Points history logging failed: ${logRes.status} ${logRes.statusText}`)
        } else {
          console.log(`✓ Points history logged for round ${round.id}`)
        }
      } catch (error) {
        console.error(`❌ Error settling bets and awarding points:`, error)
      }
    }

    const winnerCar = winnerId ? (carChoiceMap.get(winnerId) || "No car selected") : "No car selected";
    let winnerCarImage: string | null = null;
    if (winnerCar && winnerCar !== "No car selected") {
      winnerCarImage = await getTopCarImage(winnerCar);
    }

    const finalEmbed = new EmbedBuilder()
      .setTitle("🏆 Series Complete")
      .setDescription(`Winner: **${getPlayerName(winnerId)}**`)
      .addFields(
        { name: "Winning Car", value: `**${winnerCar}**`, inline: false },
        { name: "Final Scores", value: buildStandingsText() }
      )
      .setColor(0xffd700)
      .setFooter({ text: `Round ID: ${round.id}` });

    if (winnerCarImage) {
      finalEmbed.setImage(winnerCarImage);
    }

    await i.update({ embeds: [finalEmbed], components: [] });
    collector.stop();
  };

  collector.on("collect", async (i) => {
    if (i.customId === `finish_game_${round.id}`) {
      // Only allow the round creator to finish the game
      if (i.user.id !== round.created_by) {
        await i.reply({ content: "Only the person who started this round can finish it!", ephemeral: true });
        return;
      }

      if (isAllSeries) {
        totalScores.clear();
        roundPlayers.forEach(player => totalScores.set(player.id, 0));
        activeRaceIndex = 0;
        sequence = [...raceSequence];
        raceResults.clear();
        lastRacePlacements = [];
        await startRaceSelection(i, activeRaceIndex);
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
    } else if (isAllSeries && i.customId.startsWith(`racepick_${round.id}_`)) {
      if (i.user.id !== round.created_by) {
        await i.reply({ content: "Only the person who started this round can record results!", ephemeral: true });
        return;
      }

      if (!currentSelection) {
        await i.reply({ content: "No active race selection.", ephemeral: true });
        return;
      }

      const playerId = i.customId.replace(`racepick_${round.id}_`, "");
      currentSelection.placements.push(playerId);
      currentSelection.remaining = currentSelection.remaining.filter(id => id !== playerId);

      if (currentSelection.remaining.length > 0) {
        const place = currentSelection.placements.length + 1;
        const embed = new EmbedBuilder()
          .setTitle(`Select ${place}${place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'} Place - ${currentSelection.raceType.toUpperCase()}`)
          .setDescription("Pick the next finishing position.")
          .setColor(0xff8c00);

        const buttons = currentSelection.remaining.map(remainingId =>
          new ButtonBuilder()
            .setCustomId(`racepick_${round.id}_${remainingId}`)
            .setLabel(getPlayerName(remainingId))
            .setStyle(ButtonStyle.Primary)
        );

        const rows: ActionRowBuilder<ButtonBuilder>[] = [];
        for (let idx = 0; idx < buttons.length; idx += 5) {
          rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(idx, idx + 5)));
        }

        await i.update({ embeds: [embed], components: rows });
        return;
      }

      await finalizeRace(i, currentSelection.raceType, currentSelection.placements, activeRaceIndex);
      currentSelection = null;
      return;
    } else if (isAllSeries && i.customId === `race_next_${round.id}`) {
      if (i.user.id !== round.created_by) {
        await i.reply({ content: "Only the person who started this round can advance races!", ephemeral: true });
        return;
      }
      activeRaceIndex += 1;
      await startRaceSelection(i, activeRaceIndex);
      return;
    } else if (isAllSeries && i.customId === `race_redo_${round.id}`) {
      if (i.user.id !== round.created_by) {
        await i.reply({ content: "Only the person who started this round can redo races!", ephemeral: true });
        return;
      }

      const previous = raceResults.get(activeRaceIndex);
      if (previous) {
        previous.pointsByPlayer.forEach((points, playerId) => {
          totalScores.set(playerId, Math.max(0, (totalScores.get(playerId) ?? 0) - points));
        });
        raceResults.delete(activeRaceIndex);
        db.prepare("DELETE FROM round_race_results WHERE round_id = ? AND race_index = ?").run(round.id, activeRaceIndex);
        persistScores();
      }

      await startRaceSelection(i, activeRaceIndex);
      return;
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

      // Persist final scores for non-all races so placement awards can resolve winner
      const initScoreStmt = db.prepare(
        "INSERT OR IGNORE INTO round_scores (round_id, player_id, points) VALUES (?, ?, 0)"
      );
      for (const player of roundPlayers) {
        initScoreStmt.run(round.id, player.id);
      }

      const winnerScoreStmt = db.prepare(
        "INSERT INTO round_scores (round_id, player_id, points) VALUES (?, ?, ?) ON CONFLICT(round_id, player_id) DO UPDATE SET points = excluded.points"
      );
      winnerScoreStmt.run(round.id, winnerId, 1);
      console.log(`📊 Persisted non-all race winner score for round ${round.id}: ${winnerId} -> 1 point`)

      // Settle bets and award placement points via API
      try {
        const port = process.env.DASHBOARD_PORT || '34234'
        console.log(`🎯 Settling bets for round ${round.id}...`)
        const settleRes = await fetch(`http://localhost:${port}/api/bets/settle/${round.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        if (!settleRes.ok) {
          console.error(`❌ Bet settlement failed: ${settleRes.status} ${settleRes.statusText}`)
        } else {
          console.log(`✓ Bets settled for round ${round.id}`)
        }
        
        console.log(`🏆 Awarding placement points for round ${round.id}...`)
        const awardRes = await fetch(`http://localhost:${port}/api/bets/award-placement/${round.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        if (!awardRes.ok) {
          console.error(`❌ Placement award failed: ${awardRes.status} ${awardRes.statusText}`)
        } else {
          console.log(`✓ Placement points awarded for round ${round.id}`)
        }

        // Log points history for each player after round is complete
        console.log(`📊 Logging points history for round ${round.id}...`)
        const logRes = await fetch(`http://localhost:${port}/api/points-history/log/${round.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
        if (!logRes.ok) {
          console.error(`❌ Points history logging failed: ${logRes.status} ${logRes.statusText}`)
        } else {
          console.log(`✓ Points history logged for round ${round.id}`)
        }
      } catch (error) {
        console.error(`❌ Error settling bets and awarding points:`, error)
      }

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
        .addFields({ name: "Winning Car", value: `**${winnerCar}**`, inline: false });

      if (round.restrict_class !== 0) {
        finalEmbed.addFields({ name: "Class", value: round.class, inline: true });
      }

      finalEmbed.addFields(
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
