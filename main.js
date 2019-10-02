// Import node packages
const axios = require("axios");
const mongoose = require("mongoose");
mongoose.connect("mongodb://localhost/pokepedia", { useNewUrlParser: true });


// Set variables
const apiUrl = "https://pokeapi.co/api/v2";

// Timeout function for async/await
function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to retry getting the info
const axios_retry = async (url, delay, n) => {
  try {
    return await axios.get(url);
  } catch (err) {
    if (n === 1) throw err;
    await timeout(delay);
    return await axios_retry(url, delay, n - 1);
  }
};

function mapEvolvesTo(raw) {
  return raw.map(r => {
    return {
      is_baby: r.is_baby,
      species: r.species.name,
      evolution_details: r.evolution_details.map(e => {
        return {
          item: e.item !== null ? e.item.name : null,
          gender: e.gender,
          held_item: e.held_item !== null ? e.held_item.name : null,
          known_move: e.known_move !== null ? e.known_move.name : null,
          known_move_type: e.known_move_type !== null ? e.known_move_type.name : null,
          location: e.location !== null ? e.location.name : null,
          min_level: e.min_level,
          min_happiness: e.min_happiness,
          min_beauty: e.min_beauty,
          min_affection: e.min_affection,
          needs_overworld_rain: e.needs_overworld_rain,
          party_species: e.party_species !== null ? e.party_species.name : null,
          party_type: e.party_type !== null ? e.party_type.name : null,
          relative_physical_stats: e.relative_physical_stats,
          time_of_day: e.time_of_day,
          turn_upside_down: e.turn_upside_down,
          trigger: e.trigger.name,
        };
      }),
      evolves_to: r.evolves_to.length ? mapEvolvesTo(r.evolves_to) : null,
    };
  });
}

async function loadPokemonSpecies() {
  // Create mongoose schemas
  const evolvesToSchema = new mongoose.Schema();
  evolvesToSchema.add({
    is_baby: Boolean,
    species: String,
    evolution_details: [{
      item: String,
      gender: Number,
      held_item: String,
      known_move: String,
      known_move_type: String,
      location: String,
      min_level: Number,
      min_happiness: Number,
      min_beauty: Number,
      min_affection: Number,
      needs_overworld_rain: Boolean,
      party_species: String,
      party_type: String,
      relative_physical_stats: Number,
      time_of_day: String,
      turn_upside_down: Boolean,
      trigger: String,
    }],
    evolves_to: [evolvesToSchema],
  });

  const evolutionChainSchema = new mongoose.Schema({
    id: Number,
    baby_trigger_item: String,
    chain: {
      is_baby: Boolean,
      species: String,
      evolves_to: [evolvesToSchema],
    }
  });

  const moveSchema = new mongoose.Schema({
    level: Number,
    name: String,
    category: String,
    type: String,
    accuracy: Number,
    pp: Number,
    power: Number,
    description: String,
  });

  const pokemonSchema = new mongoose.Schema({
    name: { type: String, unique: true, required: true },
    sprites: {
      back_default: String,
      back_female: String,
      back_shiny: String,
      back_shiny_female: String,
      front_default: String,
      front_female: String,
      front_shiny: String,
      front_shiny_female: String
    },
    id: { type: Number, unique: true, required: true },
    type: {
      primary: String,
      secondary: String
    },
    genus: String,
    height: Number,
    weight: Number,
    abilities: [{ name: String, description: String, is_hidden: Boolean, slot: Number }],
    base_experience: Number,
    growth_rate: String,
    egg_groups: [String],
    gender_rate: Number,
    egg_cycles: Number,
    generation: Number,
    stats: [{ base_stat: Number, effort: Number, name: String }],
    evolution_chain: evolutionChainSchema,
    held_items: [{ name: String, description: String }],
    moves: [moveSchema],
    pokedex_entry: String,
    shape: String
  });

  // Make mongoose model
  const Pokemon = mongoose.model('Pokemon', pokemonSchema);

  // Load the full list of endpoints to load pokemon information from
  let response = await axios.get(`${apiUrl}/pokemon-species/?limit=1000`);

  /* Load these things in for each species
        Picture of the chosen pokémon / alternative forms
        National pokédex number
        Type
        Genus
        Height
        Weight
        Abilities
          Name
          Description
          Is hidden?
          Slot
        Base exp
        Growth rate
        Egg groups
        Gender rate
        Egg cycles
        Generation
        Stats
        Evolution chart
        Held items
          Name
          Description
        Moves
          Level
          Name
          Category
          Type
          Accuracy
          PP
          Power
          Description
        Pokédex entries - newest version
        Shape
    */

  // Cache all endpoints that might be hit multiple times - moves, genus, abilities, growth rate, egg groups, held items, shape
  const moveDictionary = {};
  const abilityDictionary = {};
  const growthRateDictionary = {};
  const eggGroupDictionary = {};
  const heldItemDictionary = {};
  const shapeDictionary = {};

  let i;
  for (i = 0; i < response.data.results.length; i++) {
    try {
      let speciesResult = await axios_retry(
        response.data.results[i].url,
        10000,
        10
      );
      let speciesData = speciesResult.data;
      let pokemonResult = await axios_retry(
        speciesData.varieties.find(v => v.is_default === true).pokemon.url,
        10000,
        10
      );
      let pokemonData = pokemonResult.data;
      let evolutionResult = await axios_retry(
        speciesData.evolution_chain.url,
        10000,
        10
      );
      let evolutionData = evolutionResult.data;

      // Load data that might be cached
      let moves = [];
      for (let move of pokemonData.moves) {
        let moveObject;
        if (moveDictionary.hasOwnProperty(move.move.name)) {
          moveObject = moveDictionary[move.move.name];
        } else {
          let result = await axios_retry(move.move.url, 10000, 10);
          moveObject = {
            level: move.version_group_details[0].level_learned_at,
            name: result.data.names.find(g => g.language.name === "en").name,
            category: result.data.damage_class.name,
            type: result.data.type.name,
            accuracy: result.data.accuracy,
            pp: result.data.pp,
            power: result.data.power,            
            description: result.data.flavor_text_entries
              .find(f => f.language.name === "en")
              .flavor_text.replace(/\n/g, " "),
          };
          moveDictionary[move.move.name] = moveObject;
          console.log('Added new move ' + moveObject.name);
        }
        moves.push(moveObject);
      }

      let abilities = [];
      for (let ability of pokemonData.abilities) {
        let abilityObject;
        if (abilityDictionary.hasOwnProperty(ability.ability.name)) {
          abilityObject = abilityDictionary[ability.ability.name];
        } else {
          let result = await axios_retry(ability.ability.url, 10000, 10);
          abilityObject = {
            name: result.data.names.find(g => g.language.name === "en").name,
            description: result.data.flavor_text_entries
              .find(f => f.language.name === "en")
              .flavor_text.replace(/\n/g, " "),
            is_hidden: ability.is_hidden,
            slot: ability.slot
          };
          abilityDictionary[ability.ability.name] = abilityObject;
          console.log("Added new ability " + abilityObject.name);
        }
        abilities.push(abilityObject);
      }

      let growthRateId = speciesData.growth_rate.name;
      let growthRateName;
      if (growthRateDictionary.hasOwnProperty(growthRateId)) {
        growthRateName = growthRateDictionary[growthRateId];
      } else {
        let result = await axios_retry(
          speciesData.growth_rate.url,
          10000,
          10
        );
        growthRateName = result.data.descriptions.find(g => g.language.name === "en").description;
        growthRateDictionary[growthRateId] = growthRateName;
        console.log("Added new growth rate " + growthRateName);
      }

      let eggGroups = [];
      for (let eggGroup of speciesData.egg_groups) {
        let eggGroupName;
        if (eggGroupDictionary.hasOwnProperty(eggGroup.name)) {
          eggGroupName = eggGroupDictionary[eggGroup.name];
        } else {
          let result = await axios_retry(
            eggGroup.url,
            10000,
            10
          );
          eggGroupName = result.data.names.find(
            g => g.language.name === "en"
          ).name;
          eggGroupDictionary[eggGroup.name] = eggGroupName;
          console.log("Added new egg group " + eggGroupName);
        }
        eggGroups.push(eggGroupName);
      }

      let heldItems = [];
      for (let heldItem of pokemonData.held_items) {
        let heldItemObject;
        if (heldItemDictionary.hasOwnProperty(heldItem.item.name)) {
          heldItemObject = heldItemDictionary[heldItem.item.name];
        } else {
          let result = await axios_retry(
            heldItem.item.url,
            10000,
            10
          );
          heldItemObject = {
            name: result.data.names.find(g => g.language.name === "en").name,
            description: result.data.flavor_text_entries
              .find(f => f.language.name === "en")
              .text.replace(/\n/g, "")
          };
          heldItemDictionary[heldItem.item.name] = heldItemObject;
          console.log("Added new held item " + heldItemObject.name);
        }
        heldItems.push(heldItemObject);
      }

      let shapeId = speciesData.shape.name;
      let shapeName;
      if (shapeDictionary.hasOwnProperty(shapeId)) {
        shapeName = shapeDictionary[shapeId];
      } else {
        let result = await axios_retry(speciesData.shape.url, 10000, 10);
        shapeName = result.data.names.find(
          g => g.language.name === "en"
        ).name;
        shapeDictionary[shapeId] = shapeName;
          console.log("Added new shape " + shapeName);
      }

      console.log('Loaded all endpoints for ' + speciesData.name);
      

      const pokemon = new Pokemon({
        name: speciesData.names.find(n => n.language.name === "en").name,
        sprites: pokemonData.sprites,
        id: speciesData.id,
        type: {
          primary: pokemonData.types.find(t => t.slot == 1).type.name,
          secondary:
            pokemonData.types.length == 2
              ? pokemonData.types.find(t => t.slot == 2).type.name
              : null
        },
        genus: speciesData.genera.find(g => g.language.name === "en").genus,
        height: pokemonData.height,
        weight: pokemonData.weight,
        abilities: abilities,
        base_experience: pokemonData.base_experience,
        growth_rate: growthRateName,
        egg_groups: eggGroups,
        gender_rate: speciesData.gender_rate, // number of eigths that are female
        egg_cycles: speciesData.hatch_counter,
        generation: parseInt(speciesData.generation.url.match(/\/([0-9]*)\/$/)[1]),
        stats: pokemonData.stats.map(s => {
          return {
            base_stat: s.base_stat,
            effort: s.effort,
            name: s.stat.name
          };
        }),
        evolution_chain: {
          id: evolutionData.id,
          baby_trigger_item:
            evolutionData.baby_trigger_item !== null 
              ? evolutionData.baby_trigger_item.name
              : null,
          chain: {
            is_baby: evolutionData.chain.is_baby,
            species: evolutionData.chain.species.name,
            evolves_to: mapEvolvesTo(evolutionData.chain.evolves_to),
          }
        },
        held_items: heldItems,
        moves: moves,
        // Entries are already sorted by version - we just need to find the first one in english
        pokedex_entry: speciesData.flavor_text_entries
          .find(f => f.language.name === "en")
          .flavor_text.replace(/\n/g, " "),
        shape: shapeName,
      });

      pokemon.save((err, p) => {
        if (err) console.error(err);
        console.log(p, i);
      });
    } catch (err) {
      console.error(err);
    }
  }
  console.log("fetched " + i);
  process.exit();
}

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
  loadPokemonSpecies();
})
