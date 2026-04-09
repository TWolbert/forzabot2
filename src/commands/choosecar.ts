import { ChatInputCommandInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, StringSelectMenuBuilder } from "discord.js";
import { searchCars, getTopCarImage, loadCarData, matchesBrandName } from "../utils";
import { CANDR_PRESET_CARS } from "../constants";
import { db } from "../database";

type ParsedPi = {
  classCode: string;
  score: number;
};

const parsePi = (pi?: string): ParsedPi | null => {
  if (!pi) return null;
  const normalized = pi.toUpperCase().replace(/\s+/g, "");
  const match = normalized.match(/^([A-Z]\d?)(\d{3})$/);
  if (!match) return null;

  return {
    classCode: match[1]!,
    score: parseInt(match[2]!, 10),
  };
};

export async function handleChooseCar(interaction: ChatInputCommandInteraction) {
  const query = interaction.options.getString("query");
  const isRandom = interaction.options.getBoolean("random") ?? false;
  const usePreset = interaction.options.getBoolean("preset") ?? false;

  if (!query && !isRandom && !usePreset) {
    await interaction.reply({ content: "Please provide a car query, enable random, or enable preset selection.", ephemeral: true });
    return;
  }

  // Get the most recent pending or active round
  const round = db.query(
    "SELECT id, value, year, brand FROM rounds WHERE status IN ('pending', 'active') ORDER BY created_at DESC LIMIT 1"
  ).get() as { id: string; value: number; year?: number | null; brand?: string | null } | null;

  const maxValue = round?.value;

  if (usePreset) {
    if (!round) {
      await interaction.reply({ content: "No active round found. Please start a round first.", ephemeral: true });
      return;
    }

    const allCars = await loadCarData();
    const affordableCars = allCars
      .filter(car => car.availability?.includes("autoshow"))
      .filter(car => !maxValue || car.value <= maxValue)
      .filter(car => !round.brand || matchesBrandName(car.name, round.brand))
      .filter(car => {
        if (round.year) {
          if (!car.year) return false;
          return car.year >= round.year - 10 && car.year <= round.year + 10;
        }
        return true;
      });

    if (affordableCars.length === 0) {
      await interaction.reply({
        content: "No preset cars are available for this round constraints.",
        ephemeral: true,
      });
      return;
    }

    const alreadyChosenCars = db.query(
      "SELECT DISTINCT car_name FROM car_choices WHERE round_id = ?"
    ).all(round.id) as { car_name: string }[];
    const alreadyChosenSet = new Set(alreadyChosenCars.map(c => c.car_name.toLowerCase()));

    const affordableMap = new Map(affordableCars.map(car => [car.name.toLowerCase(), car]));
    const presetCars: typeof affordableCars = [];

    for (const presetName of CANDR_PRESET_CARS) {
      const match = affordableMap.get(presetName.toLowerCase());
      if (match && !alreadyChosenSet.has(match.name.toLowerCase())) {
        presetCars.push(match);
      }
    }

    if (presetCars.length < 8) {
      const filler = affordableCars
        .filter(car => !alreadyChosenSet.has(car.name.toLowerCase()))
        .filter(car => !presetCars.some(p => p.name.toLowerCase() === car.name.toLowerCase()))
        .sort(() => Math.random() - 0.5)
        .slice(0, 8 - presetCars.length);
      presetCars.push(...filler);
    }

    if (presetCars.length === 0) {
      await interaction.reply({
        content: "No preset cars are currently available because all matching cars have been chosen.",
        ephemeral: true,
      });
      return;
    }

    const options = presetCars.slice(0, 25).map((car) => ({
      label: car.name.length > 100 ? `${car.name.slice(0, 97)}...` : car.name,
      value: car.name,
      description: `${car.pi ?? "N/A"} • $${car.value.toLocaleString("en-US")}`,
    }));

    const embed = new EmbedBuilder()
      .setTitle("Preset Car Selection")
      .setDescription(`Choose one preset car for round ${round.id}.`)
      .setColor(0x5865f2)
      .addFields(
        { name: "Round Budget", value: `$${round.value.toLocaleString("en-US")}`, inline: true },
        { name: "Available Presets", value: options.length.toString(), inline: true }
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("car_preset_select")
        .setPlaceholder("Select a preset car")
        .addOptions(options)
    );

    const response = await interaction.reply({ embeds: [embed], components: [row] });
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 300_000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id) {
        await i.reply({ content: "This isn't your car selection!", ephemeral: true });
        return;
      }

      if (i.customId !== "car_preset_select") return;

      const selectedCar = i.values[0];
      const selectedData = presetCars.find(car => car.name === selectedCar);

      if (!selectedCar || !selectedData) {
        await i.reply({ content: "Selected car is no longer available.", ephemeral: true });
        return;
      }

      db.prepare("DELETE FROM car_choices WHERE round_id = ? AND player_id = ?").run(round.id, i.user.id);
      db.prepare(
        "INSERT INTO car_choices (round_id, player_id, car_name, selection_method, chosen_at) VALUES (?, ?, ?, ?, ?)"
      ).run(round.id, i.user.id, selectedCar, "preset", Date.now());

      const remainingBudget = round.value - selectedData.value;
      const imageUrl = await getTopCarImage(selectedCar);

      const finalEmbed = new EmbedBuilder()
        .setTitle("Preset Car Selected")
        .setDescription(`You selected: **${selectedCar}**\nRound ID: ${round.id}`)
        .setColor(0x00c853)
        .addFields([
          { name: "Performance Index", value: selectedData.pi || "N/A", inline: true },
          { name: "Car Price", value: `$${selectedData.value.toLocaleString("en-US")}`, inline: true },
          { name: "Remaining Upgrades", value: `$${remainingBudget.toLocaleString("en-US")}`, inline: true },
        ]);

      if (imageUrl) {
        finalEmbed.setImage(imageUrl);
      }

      await i.update({ embeds: [finalEmbed], components: [] });
      collector.stop();
    });

    collector.on("end", async (_collected, reason) => {
      if (reason === "time") {
        const timeoutEmbed = new EmbedBuilder()
          .setTitle("Selection Timed Out")
          .setDescription("You took too long to select a preset car.")
          .setColor(0xff9900);
        await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
      }
    });

    return;
  }
  
  // Handle random car selection
  if (isRandom) {
    if (!round) {
      await interaction.reply({ content: "No active round found. Please start a round first.", ephemeral: true });
      return;
    }

    const randomMaxValue = maxValue ? Math.floor(maxValue * 0.8) : undefined;

    // Load all cars and filter by budget and year
    const allCars = await loadCarData();
    let validCars = allCars
      .filter(car => car.availability?.includes("autoshow"))
      .filter(car => !randomMaxValue || car.value <= randomMaxValue)
      .filter(car => !round?.brand || matchesBrandName(car.name, round.brand))
      .filter(car => {
        // If round has a year, filter to year ± 10
        if (round?.year) {
          if (!car.year) return false; // Exclude cars without year data
          return car.year >= round.year - 10 && car.year <= round.year + 10;
        }
        return true;
      });

    // Get all cars already chosen in this round and exclude them
    const alreadyChosenCars = db.query(
      "SELECT DISTINCT car_name FROM car_choices WHERE round_id = ?"
    ).all(round.id) as { car_name: string }[];
    const alreadyChosenSet = new Set(alreadyChosenCars.map(c => c.car_name));
    let carsAfterExcludingChosen = validCars.filter(car => !alreadyChosenSet.has(car.name));

    // If no cars left after excluding already chosen ones, widen balancing
    let hadToWidenForAvailability = false;
    if (carsAfterExcludingChosen.length === 0) {
      hadToWidenForAvailability = true;
      // Fall back to all cars with just budget and brand constraints
      carsAfterExcludingChosen = allCars
        .filter(car => car.availability?.includes("autoshow"))
        .filter(car => !randomMaxValue || car.value <= randomMaxValue)
        .filter(car => !round?.brand || matchesBrandName(car.name, round.brand))
        .filter(car => !alreadyChosenSet.has(car.name));
    }

    validCars = carsAfterExcludingChosen;

    const firstRandomChoice = db.query(
      "SELECT car_name FROM car_choices WHERE round_id = ? AND selection_method = 'random' ORDER BY chosen_at ASC LIMIT 1"
    ).get(round.id) as { car_name: string } | null;

    let balancingAnchorCar: typeof validCars[number] | null = null;

    // Only apply strict balancing if we didn't have to widen for availability
    if (firstRandomChoice && !hadToWidenForAvailability) {
      balancingAnchorCar = allCars.find((car) => car.name === firstRandomChoice.car_name) ?? null;

      if (balancingAnchorCar) {
        const anchorPi = parsePi(balancingAnchorCar.pi);
        const valueTolerance = Math.max(25_000, Math.round(balancingAnchorCar.value * 0.45));
        const strictMinValue = Math.max(0, balancingAnchorCar.value - valueTolerance);
        const strictMaxValue = Math.min(randomMaxValue ?? Number.MAX_SAFE_INTEGER, balancingAnchorCar.value + valueTolerance);

        const strictBalancedCars = validCars.filter((car) => {
          const withinValueRange = car.value >= strictMinValue && car.value <= strictMaxValue;
          if (!withinValueRange) return false;

          if (!anchorPi) return true;

          const carPi = parsePi(car.pi);
          if (!carPi) return false;
          if (carPi.classCode !== anchorPi.classCode) return false;

          return Math.abs(carPi.score - anchorPi.score) <= 75;
        });

        if (strictBalancedCars.length > 0) {
          validCars = strictBalancedCars;
        } else {
          const relaxedTolerance = Math.max(50_000, Math.round(balancingAnchorCar.value * 0.75));
          const relaxedMinValue = Math.max(0, balancingAnchorCar.value - relaxedTolerance);
          const relaxedMaxValue = Math.min(randomMaxValue ?? Number.MAX_SAFE_INTEGER, balancingAnchorCar.value + relaxedTolerance);

          const relaxedBalancedCars = validCars.filter((car) => {
            const withinValueRange = car.value >= relaxedMinValue && car.value <= relaxedMaxValue;
            if (!withinValueRange) return false;

            if (!anchorPi) return true;

            const carPi = parsePi(car.pi);
            if (!carPi) return false;
            
            // Allow same class or adjacent classes (e.g., A -> S1, B, or A; S1 -> S2 or A)
            const classOrder = ['D', 'C', 'B', 'A', 'S1', 'S2', 'X'];
            const anchorIdx = classOrder.indexOf(anchorPi.classCode);
            const carIdx = classOrder.indexOf(carPi.classCode);
            
            if (anchorIdx === -1 || carIdx === -1) return carPi.classCode === anchorPi.classCode;
            return Math.abs(anchorIdx - carIdx) <= 1;
          });

          if (relaxedBalancedCars.length > 0) {
            validCars = relaxedBalancedCars;
          }
        }
      }
    } else if (firstRandomChoice && hadToWidenForAvailability) {
      // If we had to widen availability, apply ultra-relaxed balancing
      balancingAnchorCar = allCars.find((car) => car.name === firstRandomChoice.car_name) ?? null;
      
      if (balancingAnchorCar) {
        const anchorPi = parsePi(balancingAnchorCar.pi);
        // Ultra-wide price tolerance when availability was constrained
        const ultraTolerance = Math.max(100_000, Math.round(balancingAnchorCar.value * 1.0));
        const ultraMinValue = Math.max(0, balancingAnchorCar.value - ultraTolerance);
        const ultraMaxValue = Math.min(randomMaxValue ?? Number.MAX_SAFE_INTEGER, balancingAnchorCar.value + ultraTolerance);

        const ultraBalancedCars = validCars.filter((car) => {
          const withinValueRange = car.value >= ultraMinValue && car.value <= ultraMaxValue;
          return withinValueRange;
        });

        if (ultraBalancedCars.length > 0) {
          validCars = ultraBalancedCars;
        }
      }
    }

    if (validCars.length === 0) {
      const constraints = [];
      if (maxValue) constraints.push(`$${maxValue.toLocaleString("en-US")} budget`);
      if (randomMaxValue) constraints.push(`random cap $${randomMaxValue.toLocaleString("en-US")} (20% upgrade room)`);
      if (round?.year && !hadToWidenForAvailability) constraints.push(`years ${round.year - 10}-${round.year + 10}`);
      if (round?.brand) constraints.push(`brand ${round.brand}`);
      if (balancingAnchorCar && !hadToWidenForAvailability) constraints.push(`balance range near ${balancingAnchorCar.name}`);
      const alreadyChosen = alreadyChosenSet.size > 0 ? ` (${alreadyChosenSet.size} cars already chosen)` : "";
      const description = `No cars found within ${constraints.join(" and ")}${constraints.length > 0 ? "." : "budget."}${alreadyChosen}`;
      await interaction.reply({ 
        embeds: [new EmbedBuilder()
          .setTitle("No cars available")
          .setDescription(description)
        ], 
        ephemeral: true 
      });
      return;
    }

    const randomIndex = Math.floor(Math.random() * validCars.length);
    const selectedCarData = validCars[randomIndex]!;
    const selectedCarName = selectedCarData.name;

    // Save car choice to database (override previous selection if any)
    const clearStmt = db.prepare(
      "DELETE FROM car_choices WHERE round_id = ? AND player_id = ?"
    );
    clearStmt.run(round.id, interaction.user.id);

    const carChoiceStmt = db.prepare(
      "INSERT INTO car_choices (round_id, player_id, car_name, selection_method, chosen_at) VALUES (?, ?, ?, ?, ?)"
    );
    carChoiceStmt.run(round.id, interaction.user.id, selectedCarName, "random", Date.now());

    const remainingBudget = maxValue! - (selectedCarData?.value || 0);

    const finalEmbed = new EmbedBuilder()
      .setTitle("🎲 Random Car Selected")
      .setDescription(`You got: **${selectedCarName}**\nRound ID: ${round.id}`)
      .setColor(0x9b59b6)
      .addFields([
        { name: "Performance Index", value: selectedCarData?.pi || "N/A", inline: true },
        { name: "Car Price", value: `$${(selectedCarData?.value || 0).toLocaleString("en-US")}`, inline: true },
        { name: "Remaining Upgrades", value: `$${remainingBudget.toLocaleString("en-US")}`, inline: true },
      ]);

    if (balancingAnchorCar) {
      finalEmbed.addFields({
        name: "Balance Anchor",
        value: `${balancingAnchorCar.name} (${balancingAnchorCar.pi || "N/A"}, $${balancingAnchorCar.value.toLocaleString("en-US")})`,
      });
    }

    const imageUrl = await getTopCarImage(selectedCarName);
    if (imageUrl) {
      finalEmbed.setImage(imageUrl);
    }

    await interaction.reply({ embeds: [finalEmbed] });
    return;
  }

  const results = await searchCars(query!, maxValue);

  // Load car data for details and round-specific filtering
  const allCarData = await loadCarData();
  const carDataMap = new Map(allCarData.map(car => [car.name, car]));

  const filteredResults = results.filter((carName) => {
    if (!round?.brand) return true;
    return matchesBrandName(carName, round.brand);
  });

  if (filteredResults.length === 0) {
    const brandSuffix = round?.brand ? ` for brand "${round.brand}"` : "";
    const emptyEmbed = new EmbedBuilder()
      .setTitle("No cars found")
      .setDescription(
        maxValue 
          ? `No cars found for "${query}"${brandSuffix} within $${maxValue.toLocaleString("en-US")} budget.`
          : `No cars found for "${query}"${brandSuffix}.`
      );
    await interaction.reply({ embeds: [emptyEmbed], ephemeral: true });
    return;
  }

  let currentIndex = 0;

  const formatCurrency = (value: number): string =>
    `$${value.toLocaleString("en-US")}`;

  const createCarEmbed = async (index: number) => {
    const carName = filteredResults[index];
    if (!carName) return new EmbedBuilder().setTitle("Error").setDescription("Car not found");
    
    const carData = carDataMap.get(carName);
    const imageUrl = await getTopCarImage(carName);
    const remainingBudget = maxValue! - (carData?.value || 0);
    
    const embed = new EmbedBuilder()
      .setTitle(carName)
      .setDescription(
        maxValue
          ? `Car ${index + 1} of ${filteredResults.length} (Max: ${formatCurrency(maxValue)})`
          : `Car ${index + 1} of ${filteredResults.length}`
      )
      .addFields([
        { name: "Performance Index", value: carData?.pi || "N/A", inline: true },
        { name: "Car Price", value: `${formatCurrency(carData?.value || 0)}`, inline: true },
        { name: "Remaining Upgrades", value: `${formatCurrency(remainingBudget)}`, inline: true },
      ]);
    
    if (imageUrl) {
      embed.setImage(imageUrl);
    }
    
    return embed;
  };

  const createButtons = (index: number) => {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("car_reject")
        .setLabel("❌")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("car_accept")
        .setLabel("✓")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("car_prev")
        .setLabel("◀")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index === 0),
      new ButtonBuilder()
        .setCustomId("car_next")
        .setLabel("▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(index >= filteredResults.length - 1)
    );
  };

  const embed = await createCarEmbed(currentIndex);
  const row = createButtons(currentIndex);

  const response = await interaction.reply({
    embeds: [embed],
    components: [row],
  });

  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 300_000,
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: "This isn't your car selection!", ephemeral: true });
      return;
    }

    if (i.customId === "car_next") {
      currentIndex = Math.min(currentIndex + 1, filteredResults.length - 1);
      const newEmbed = await createCarEmbed(currentIndex);
      const newRow = createButtons(currentIndex);
      await i.update({ embeds: [newEmbed], components: [newRow] });
    } else if (i.customId === "car_prev") {
      currentIndex = Math.max(currentIndex - 1, 0);
      const newEmbed = await createCarEmbed(currentIndex);
      const newRow = createButtons(currentIndex);
      await i.update({ embeds: [newEmbed], components: [newRow] });
    } else if (i.customId === "car_accept") {
      const selectedCar = filteredResults[currentIndex];
      if (!selectedCar) {
        await i.reply({ content: "Error: Car not found", ephemeral: true });
        return;
      }

      // Get the most recent round ID
      const recentRound = db.query(
        "SELECT id, value FROM rounds WHERE status IN ('pending', 'active') ORDER BY created_at DESC LIMIT 1"
      ).get() as { id: string; value: number } | null;
      
      if (!recentRound) {
        await i.update({ content: "No active round found. Please start a round first.", embeds: [], components: [] });
        collector.stop();
        return;
      }

      // Save car choice to database (override previous selection if any)
      const clearStmt = db.prepare(
        "DELETE FROM car_choices WHERE round_id = ? AND player_id = ?"
      );
      clearStmt.run(recentRound.id, i.user.id);

      const carChoiceStmt = db.prepare(
        "INSERT INTO car_choices (round_id, player_id, car_name, selection_method, chosen_at) VALUES (?, ?, ?, ?, ?)"
      );
      carChoiceStmt.run(recentRound.id, i.user.id, selectedCar, "manual", Date.now());

      const carData = carDataMap.get(selectedCar);
      const remainingBudget = recentRound.value - (carData?.value || 0);

      const finalEmbed = new EmbedBuilder()
        .setTitle("Car Selected")
        .setDescription(`You selected: **${selectedCar}**\nRound ID: ${recentRound.id}`)
        .setColor(0x00ff00)
        .addFields([
          { name: "Performance Index", value: carData?.pi || "N/A", inline: true },
          { name: "Car Price", value: `${formatCurrency(carData?.value || 0)}`, inline: true },
          { name: "Remaining Upgrades", value: `${formatCurrency(remainingBudget)}`, inline: true },
        ]);

      const imageUrl = await getTopCarImage(selectedCar);
      if (imageUrl) {
        finalEmbed.setImage(imageUrl);
      }

      await i.update({ embeds: [finalEmbed], components: [] });
      collector.stop();
    } else if (i.customId === "car_reject") {
      const cancelEmbed = new EmbedBuilder()
        .setTitle("Selection Cancelled")
        .setDescription("You didn't select a car.")
        .setColor(0xff0000);
      await i.update({ embeds: [cancelEmbed], components: [] });
      collector.stop();
    }
  });

  collector.on("end", async (collected, reason) => {
    if (reason === "time") {
      const timeoutEmbed = new EmbedBuilder()
        .setTitle("Selection Timed Out")
        .setDescription("You took too long to select a car.")
        .setColor(0xff9900);
      await interaction.editReply({ embeds: [timeoutEmbed], components: [] });
    }
  });
}
