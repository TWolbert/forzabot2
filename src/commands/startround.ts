import { randomUUID } from "node:crypto";
import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import path from "node:path";
import { pickRandom, randomIntStep, formatCurrency, getRaceIconPath } from "../utils";
import { CAR_CLASSES, RACE_TYPES, CLASS_VALUE_RANGES, CLASS_COLORS } from "../constants";
import { db } from "../database";

export async function handleStartRound(interaction: ChatInputCommandInteraction) {
  const roundId = randomUUID();
  const restrictClass = interaction.options.getBoolean("restrict_class") ?? false;
  const carClass = restrictClass ? pickRandom(CAR_CLASSES) : pickRandom(CAR_CLASSES);
  const chosenRaceType = interaction.options.getString("race_type");
  const raceType = chosenRaceType ?? pickRandom(RACE_TYPES);
  const year = interaction.options.getInteger("year");
  const [minValue, maxValue] = restrictClass ? CLASS_VALUE_RANGES[carClass] : [50_000, 500_000];
  const value = randomIntStep(minValue, maxValue, 25_000);

  // Collect players and ensure uniqueness
  const playerIds = new Set<string>();
  const players = [];
  for (let i = 1; i <= 8; i++) {
    const user = interaction.options.getUser(`player${i}`);
    if (user && !playerIds.has(user.id)) {
      playerIds.add(user.id);
      players.push(user);
    }
  }

  // Save round to database
  const roundStmt = db.prepare(
    "INSERT INTO rounds (id, class, value, race_type, year, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  roundStmt.run(roundId, carClass, value, raceType, year, "pending", Date.now(), interaction.user.id);

  // Save players and link to round
  const playerStmt = db.prepare(
    "INSERT OR IGNORE INTO players (id, username, display_name, created_at) VALUES (?, ?, ?, ?)"
  );
  const roundPlayerStmt = db.prepare(
    "INSERT OR IGNORE INTO round_players (round_id, player_id) VALUES (?, ?)"
  );

  for (const user of players) {
    playerStmt.run(user.id, user.username, user.displayName, Date.now());
    roundPlayerStmt.run(roundId, user.id);
    
    // Cache Discord avatar URLs
    try {
      const avatarUrl = user.displayAvatarURL({ size: 256 });
      const avatarStmt = db.prepare(
        "INSERT INTO discord_avatars (player_id, avatar_url, cached_at) VALUES (?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET avatar_url = ?, cached_at = ?"
      );
      avatarStmt.run(user.id, avatarUrl, Date.now(), avatarUrl, Date.now());
    } catch (e) {
      console.error(`Failed to cache avatar for ${user.id}:`, e);
    }
  }

  const raceIconPath = await getRaceIconPath(raceType);

  const embed = new EmbedBuilder()
    .setTitle("Forza Round")
    .setColor(CLASS_COLORS[carClass])
    .addFields(
      { name: "Class", value: carClass, inline: true },
      { name: "Value", value: formatCurrency(value), inline: true },
      { name: "Race Type", value: raceType, inline: true }
    );

  if (year) {
    embed.addFields({ name: "Year", value: year.toString(), inline: true });
  }

  // Add players field
  const playerMentions = players.map((user) => `<@${user.id}>`).join("\n");
  embed.addFields({ name: "Players", value: playerMentions, inline: false });

  embed.setFooter({ text: `Round ID: ${roundId}` });

  const files: Array<{ attachment: string; name: string }> = [];

  if (raceIconPath) {
    const raceName = `race-${path.basename(raceIconPath)}`;
    embed.setImage(`attachment://${raceName}`);
    files.push({ attachment: raceIconPath, name: raceName });
  }

  await interaction.reply({ embeds: [embed], files });
}
