import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import { searchCars } from "../utils";
import { db } from "../database";

export async function handleTimes(interaction: ChatInputCommandInteraction) {
  const raceName = interaction.options.getString("race");
  const carQuery = interaction.options.getString("car");

  // If car query is provided, search for matching cars
  let carNames: string[] = [];
  if (carQuery) {
    carNames = await searchCars(carQuery);
    if (carNames.length === 0) {
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setTitle("No Cars Found")
          .setDescription(`No cars found matching "**${carQuery}**"`)
          .setColor(0xff9900)
        ],
        ephemeral: true
      });
      return;
    }
  }

  let query = `
    SELECT 
      t.id,
      r.name as race_name,
      p.display_name,
      p.username,
      t.car_name,
      t.laptime,
      t.created_at
    FROM times t
    JOIN races r ON t.race_id = r.id
    JOIN players p ON t.player_id = p.id
    WHERE 1=1
      AND t.is_historic = 0
  `;
  const params: any[] = [];

  if (raceName) {
    query += ` AND r.name = ?`;
    params.push(raceName);
  }

  if (carNames.length > 0) {
    const placeholders = carNames.map(() => "?").join(",");
    query += ` AND t.car_name IN (${placeholders})`;
    params.push(...carNames);
  }

  query += ` ORDER BY t.laptime ASC LIMIT 20`;

  const times = db.query(query).all(...params) as Array<{
    id: number;
    race_name: string;
    display_name: string;
    username: string;
    car_name: string;
    laptime: number;
    created_at: number;
  }>;

  if (times.length === 0) {
    let description = "No times found";
    if (raceName && carQuery) {
      description += ` for **${carQuery}** on **${raceName}**`;
    } else if (raceName) {
      description += ` on **${raceName}**`;
    } else if (carQuery) {
      description += ` with **${carQuery}**`;
    }
    description += ".";

    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setTitle("No Times Found")
        .setDescription(description)
        .setColor(0xff9900)
      ],
      ephemeral: true
    });
    return;
  }

  const timeList = times.map((time, index) => {
    const minutes = Math.floor(time.laptime / 60000);
    const seconds = Math.floor((time.laptime % 60000) / 1000);
    const ms = time.laptime % 1000;
    const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
    
    const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
    return `${medal} **${timeStr}** - ${time.display_name || time.username} - ${time.car_name} - ${time.race_name}`;
  }).join("\n");

  let title = "⏱️ Best Times";
  if (raceName && carQuery) {
    title += ` - ${carNames[0]} on ${raceName}`;
  } else if (raceName) {
    title += ` - ${raceName}`;
  } else if (carQuery) {
    title += ` - ${carNames[0]}`;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(timeList)
    .setColor(0x3498db)
    .setFooter({ text: `Showing ${times.length} time${times.length !== 1 ? "s" : ""}` });

  await interaction.reply({ embeds: [embed] });
}
