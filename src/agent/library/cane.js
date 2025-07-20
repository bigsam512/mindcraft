import * as world from "./world.js";
import { log, wait, placeBlock, goToPosition } from "./skills.js";
import Vec3 from 'vec3';

// Helper functions (ordered by dependency)
async function equipItem(bot, itemName, hand = 'hand') {
    const item = bot.inventory.findInventoryItem(itemName, null);
    if (item) {
        try {
            await bot.equip(item, hand);
            log(bot, `Successfully equipped ${itemName} to ${hand}`);
            return true;
        } catch (e) {
            log(bot, `Error equipping ${itemName} to ${hand}: ${e}`);
            return false;
        }
    } else {
        log(bot, `No ${itemName} found in inventory.`);
        return false;
    }
}

async function placeOnBlock(bot, itemName, coords, directionVec = new Vec3(0, 1, 0)) {
    if (!bot.origin) {
        log(bot, "Origin not set. Setting origin to current current position.");
        await setOrigin(bot);
    }
    const [x, y, z] = coords;
    const absX = bot.origin.position.x + x;
    const absY = bot.origin.position.y + y;
    const absZ = bot.origin.position.z - z; // Positive Z now means forward (negative world Z)

    const block = bot.blockAt(new Vec3(absX, absY, absZ));
    if (!block) {
        log(bot, `(${absX.toFixed(1)},${absY.toFixed(1)},${absZ.toFixed(1)}) No supporting block, cannot place ${itemName}`);
        return false;
    }
    
    if (!await equipItem(bot, itemName, 'hand')) {
        log(bot, `Cannot equip ${itemName}.`);
        return false;
    }

    const maxRetries = 3;
    const skipAirCheck = true;

    if (!skipAirCheck) {
        const targetPos = new Vec3(absX + directionVec.x, absY + directionVec.y, absZ + directionVec.z);
        const targetBlock = bot.blockAt(targetPos);
        if (targetBlock && targetBlock.name !== 'air') {
            log(bot, `Warning: Target insertion position occupied by ${targetBlock.name}, cannot insert!`);
            return false;
        }
    }

    for (let retry = 0; retry < maxRetries; retry++) {
        try {
            await bot.placeBlock(block, directionVec);
            log(bot, `Successfully placed ${itemName} at ${block.position} in direction ${directionVec}`);
            return true;
        } catch (e) {
            if (e.message && e.message.includes("blockUpdate")) {
                log(bot, `Placed ${itemName} successfully, but no blockUpdate event received (can ignore this error), details: ${e.message}`);
                return true;
            } else {
                log(bot, `Attempt ${retry + 1} to place ${itemName} failed: ${e.message}`);
            }
        }
    }
    return false;
}

async function pourWaterInHole(bot, dx, dy, dz) {
    log(bot, `Pouring water at relative coords (${dx},${dy},${dz})`);

    if (!bot.origin) {
        log(bot, "Origin not set. Setting origin to current position.");
        await setOrigin(bot);
    }

    // Calculate the world coordinates for the target
    const yaw = bot.origin.yaw;
    const forwardVec = new Vec3(0, 0, -1);
    const rightVec = new Vec3(1, 0, 0);

    const lookAtPoint = bot.origin.position.clone()
        .add(rightVec.scaled(dx))
        .add(new Vec3(0, dy, 0))
        .add(forwardVec.scaled(dz));

    try {
        // 1. Equip the water bucket.
        if (!await equipItem(bot, 'water_bucket', 'hand')) {
            log(bot, "Cannot equip water_bucket.");
            return false;
        }
        log(bot, "Equipped water bucket.");

        // 2. Look at the target point to pour water.
        log(bot, `Looking at target point ${lookAtPoint.x.toFixed(1)}, ${lookAtPoint.y.toFixed(1)}, ${lookAtPoint.z.toFixed(1)} to pour water...`);
        await bot.lookAt(lookAtPoint);
        await wait(bot, 200); // Give bot time to look

        // 3. Activate the item (water bucket) to pour water.
        await bot.activateItem();
        log(bot, "✅ Successfully poured water into the hole.");
        await wait(bot, 1000); // Wait a bit for the water to flow

        return true;
    } catch (e) {
        log(bot, `❌ Error pouring water: ${e}`);
        return false;
    }
}

async function setOrigin(bot) {
    /**
     * Sets the bot's current position and yaw as the origin for relative coordinates.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     */
    bot.origin = {
        position: bot.entity.position.clone(),
        yaw: bot.entity.yaw
    };
    log(bot, `Origin set to ${bot.origin.position} with yaw ${bot.origin.yaw}`);
    return true;
}

async function walkTo(bot, dx, dy, dz) {
    /**
     * Navigates to a position relative to the bot's set origin.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} dx, the relative x coordinate (right).
     * @param {number} dy, the relative y coordinate (up).
     * @param {number} dz, the relative z coordinate (forward).
     */
    if (!bot.origin) {
        log(bot, "Origin not set. Setting origin to current position.");
        await setOrigin(bot);
    }

    const targetPos = new Vec3(
        bot.origin.position.x + dx,
        bot.origin.position.y + dy,
        bot.origin.position.z - dz
    );

    log(bot, `Going to relative coords (${dx},${dy},${dz}) -> world coords (${targetPos.x.toFixed(1)}, ${targetPos.y.toFixed(1)}, ${targetPos.z.toFixed(1)})`);
    return await goToPosition(bot, targetPos.x, targetPos.y, targetPos.z);
}

async function acquireItems(bot) {
    /**
     * Checks for a list of required items and gives them to the bot if they are missing.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @returns {Promise<boolean>} true if the items were acquired, false otherwise.
     * @example
     * await skills.acquireItems(bot);
     **/
    const requiredItems = {
        'chest': 2,
        'hopper': 6,
        'rail': 3,
        'powered_rail': 2,
        'oak_planks': 45,
        'redstone_block': 2,
        'grass_block': 17,
        'water_bucket': 5,
        'piston': 5,
        'observer': 5,
        'redstone': 5,
        'sugar_cane': 5,
        'glass': 21,
        'hopper_minecart': 1
    };

    log(bot, "Checking and acquiring necessary items...");

    for (const itemName in requiredItems) {
        const requiredAmount = requiredItems[itemName];
        const currentAmount = world.getInventoryCounts(bot)[itemName] || 0;

        if (currentAmount < requiredAmount) {
            const amountToGive = requiredAmount - currentAmount;
            log(bot, `Inventory has ${currentAmount} of ${itemName}, need ${requiredAmount}. Giving ${amountToGive}.`);
            bot.chat(`/give @s ${itemName} ${amountToGive}`);
            await wait(bot, 200); // Wait a bit for the command to process
        } else {
            log(bot, `Already have enough ${itemName}.`);
        }
    }
    log(bot, "Finished acquiring items.");
    return true;
}

async function jumpForDuration(bot, duration) {
    /**
     * Jumps repeatedly for a given duration.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} duration, the duration to jump for in milliseconds.
     * @returns {Promise<boolean>} true if the bot jumped, false otherwise.
     * @example
     * await skills.jumpForDuration(bot, 5000);
     **/
    log(bot, `Bot will jump for ${duration / 1000} seconds.`);
    const endTime = Date.now() + duration;
    while (Date.now() < endTime) {
        if (bot.interrupt_code) {
            log(bot, "Jumping interrupted.");
            break;
        }
        bot.setControlState('jump', true);
        await wait(bot, 100); // Keep jump pressed for a short time
        bot.setControlState('jump', false);
        await wait(bot, 100); // Wait before next jump
    }
    bot.setControlState('jump', false); // Ensure it's off
    log(bot, "Bot stopped jumping.");
    return true;
}

async function walkNorth(bot, steps) {
    /**
     * Walks a certain number of steps (blocks) to the north.
     * @param {MinecraftBot} bot, reference to the minecraft bot.
     * @param {number} steps, the number of blocks to walk north.
     * @returns {Promise<boolean>} true if the bot moved, false otherwise.
     * @example
     * await skills.walkNorth(bot, 10);
     **/
    const currentPos = bot.entity.position;
    const targetZ = currentPos.z - steps; // North is negative Z

    log(bot, `Walking north ${steps} blocks...`);
    return await goToPosition(bot, currentPos.x, currentPos.y, targetZ, 1);
}

// Main function (exported)
export async function makeCaneMachine(bot) {
    await jumpForDuration(bot, 5000);
    await walkNorth(bot, 10);
    await acquireItems(bot);
    await setOrigin(bot);
    //await placeInitialChests(bot);
    await placeOnBlock(bot, "chest", [0, -1, 1]);
    await walkTo(bot, 0, 0, 8);
    bot.setControlState('sneak', true);
    // cane.py lines 118-124
    await placeOnBlock(bot, "hopper", [0, 0, 2], new Vec3(0, 0, -1));
    await placeOnBlock(bot, "hopper", [0, 0, 2], new Vec3(0, 0, -1));
    await placeOnBlock(bot, "hopper", [0, 0, 3], new Vec3(-1, 0, 0));
    await placeOnBlock(bot, "hopper", [-1, 0, 3], new Vec3(-1, 0, 0));
    await placeOnBlock(bot, "hopper", [0, 0, 3], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "hopper", [1, 0, 3], new Vec3(1, 0, 0));
    // cane.py lines 125-150
    await placeOnBlock(bot, "powered_rail", [-2, 0, 3]);
    await placeOnBlock(bot, "rail", [-1, 0, 3]);
    await placeOnBlock(bot, "rail", [0, 0, 3]);
    await placeOnBlock(bot, "rail", [1, 0, 3]);
    await placeOnBlock(bot, "powered_rail", [2, 0, 3]);
    bot.setControlState('sneak', false);

    await placeOnBlock(bot, "oak_planks", [-3, -1, 3]);
    await placeOnBlock(bot, "oak_planks", [-3, 0, 3]);
    await placeOnBlock(bot, "oak_planks", [3, -1, 3]);
    await placeOnBlock(bot, "oak_planks", [3, 0, 3]);

    await placeOnBlock(bot, "oak_planks", [-3, -1, 4]);
    await placeOnBlock(bot, "oak_planks", [-3, 0, 4]);
    await placeOnBlock(bot, "oak_planks", [3, -1, 4]);
    await placeOnBlock(bot, "oak_planks", [3, 0, 4]);
    await placeOnBlock(bot, "oak_planks", [-2, -1, 4]);
    await placeOnBlock(bot, "redstone_block", [-2, 0, 4]);
    await placeOnBlock(bot, "oak_planks", [-1, -1, 4]);
    await placeOnBlock(bot, "oak_planks", [-1, 0, 4]);
    await placeOnBlock(bot, "oak_planks", [2, -1, 4]);
    await placeOnBlock(bot, "redstone_block", [2, 0, 4]);
    await placeOnBlock(bot, "oak_planks", [1, -1, 4]);
    await placeOnBlock(bot, "oak_planks", [1, 0, 4]);
    await placeOnBlock(bot, "oak_planks", [0, -1, 4]);
    await placeOnBlock(bot, "oak_planks", [0, 0, 4]);
    // cane.py lines 152-183
    await placeOnBlock(bot, "grass_block", [-3, -1, 5]);  //台阶
    await walkTo(bot, 0, 2, 4);
    await placeOnBlock(bot, "grass_block", [-2, 1, 3]);
    await placeOnBlock(bot, "grass_block", [-1, 1, 3]);
    await placeOnBlock(bot, "grass_block", [0, 1, 3]);
    await placeOnBlock(bot, "grass_block", [1, 1, 3]);
    await placeOnBlock(bot, "grass_block", [2, 1, 3]);

    await placeOnBlock(bot, "oak_planks", [3, 1, 4]);
    await placeOnBlock(bot, "oak_planks", [3, 1, 3]);
    await placeOnBlock(bot, "oak_planks", [-3, 1, 4]);
    await placeOnBlock(bot, "oak_planks", [-3, 1, 3]);

    await placeOnBlock(bot, "oak_planks", [-3, 2, 3], new Vec3(0, 0, 1));
    await placeOnBlock(bot, "oak_planks", [-3, 2, 2], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [-2, 2, 2], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [-1, 2, 2], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [0, 2, 2], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [1, 2, 2], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [2, 2, 2], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [-3, 2, 4], new Vec3(0, 0, -1));
    await placeOnBlock(bot, "oak_planks", [-3, 2, 5], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [-2, 2, 5], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [-1, 2, 5], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [0, 2, 5], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [1, 2, 5], new Vec3(1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [2, 2, 5], new Vec3(1, 0, 0));
    await walkTo(bot, 0, 4, 3);
    await pourWaterInHole(bot, -2, 2, 4);
    await pourWaterInHole(bot, -1, 2, 4);
    await pourWaterInHole(bot, 0, 2, 4);
    await pourWaterInHole(bot, 1, 2, 4);
    await pourWaterInHole(bot, 2, 2, 4);
    await placeOnBlock(bot, "sugar_cane", [2, 2, 3]);
    await placeOnBlock(bot, "sugar_cane", [1, 2, 3]);
    await placeOnBlock(bot, "sugar_cane", [0, 2, 3]);
    await placeOnBlock(bot, "sugar_cane", [-1, 2, 3]);
    await placeOnBlock(bot, "sugar_cane", [-2, 2, 3]);
    await placeOnBlock(bot, "oak_planks", [3, 2, 4]);
    await placeOnBlock(bot, "oak_planks", [-3, 2, 4]);
    await placeOnBlock(bot, "oak_planks", [3, 3, 4], new Vec3(-1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [2, 3, 4], new Vec3(-1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [1, 3, 4], new Vec3(-1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [0, 3, 4], new Vec3(-1, 0, 0));
    await placeOnBlock(bot, "oak_planks", [-1, 3, 4], new Vec3(-1, 0, 0));
    // cane.py lines 188-198
    await walkTo(bot, -2, 4, 3);
    await placeOnBlock(bot, "piston", [-2, 3, 4]);
    await walkTo(bot, -1, 4, 3);
    await placeOnBlock(bot, "piston", [-1, 3, 4]);
    await walkTo(bot, 0, 4, 3);
    await placeOnBlock(bot, "piston", [0, 3, 4]);
    await walkTo(bot, 1, 4, 3);
    await placeOnBlock(bot, "piston", [1, 3, 4]);
    await walkTo(bot, 2, 4, 3);
    await placeOnBlock(bot, "piston", [2, 3, 4]);
    await walkTo(bot, 3, 4, 4);
    // cane.py lines 193-198
    await placeOnBlock(bot, "grass_block", [-2, 2, 5]);
    await placeOnBlock(bot, "grass_block", [-1, 2, 5]);
    await placeOnBlock(bot, "grass_block", [0, 2, 5]);
    await placeOnBlock(bot, "grass_block", [1, 2, 5]);
    await placeOnBlock(bot, "grass_block", [2, 2, 5]);
    await placeOnBlock(bot, "grass_block", [3, 2, 5]);
    await walkTo(bot, -2, 5, 6);
    await placeOnBlock(bot, "observer", [-2, 4, 4]);
    await walkTo(bot, -1, 5, 6);
    await placeOnBlock(bot, "observer", [-1, 4, 4]);
    await walkTo(bot, 0, 5, 6);
    await placeOnBlock(bot, "observer", [0, 4, 4]);
    await walkTo(bot, 1, 5, 6);
    await placeOnBlock(bot, "observer", [1, 4, 4]);
    await walkTo(bot, 2, 5, 6);
    await placeOnBlock(bot, "observer", [2, 4, 4]);
    await walkTo(bot, 3, 5, 6);
    await placeOnBlock(bot, "grass_block", [-2, 3, 5]);
    await placeOnBlock(bot, "grass_block", [-1, 3, 5]);
    await placeOnBlock(bot, "grass_block", [0, 3, 5]);
    await placeOnBlock(bot, "grass_block", [1, 3, 5]);
    await placeOnBlock(bot, "grass_block", [2, 3, 5]);
    await placeOnBlock(bot, "redstone", [2, 4, 5]);
    await placeOnBlock(bot, "redstone", [1, 4, 5]);
    await placeOnBlock(bot, "redstone", [0, 4, 5]);
    await placeOnBlock(bot, "redstone", [-1, 4, 5]);
    await placeOnBlock(bot, "redstone", [-2, 4, 5]);

    await walkTo(bot, 0, 2, 2);
    await placeOnBlock(bot, "glass", [-3, 2, 3]);
    await placeOnBlock(bot, "glass", [-3, 3, 3]);
    await placeOnBlock(bot, "glass", [-3, 4, 3]);
    await placeOnBlock(bot, "glass", [-2, 2, 2]);
    await placeOnBlock(bot, "glass", [-2, 3, 2]);
    await placeOnBlock(bot, "glass", [-2, 4, 2]);
    await placeOnBlock(bot, "glass", [-1, 2, 2]);
    await placeOnBlock(bot, "glass", [-1, 3, 2]);
    await placeOnBlock(bot, "glass", [-1, 4, 2]);
    await placeOnBlock(bot, "glass", [3, 2, 3]);
    await placeOnBlock(bot, "glass", [3, 3, 3]);
    await placeOnBlock(bot, "glass", [3, 4, 3]);
    await placeOnBlock(bot, "glass", [2, 2, 2]);
    await placeOnBlock(bot, "glass", [2, 3, 2]);
    await placeOnBlock(bot, "glass", [2, 4, 2]);
    await placeOnBlock(bot, "glass", [1, 2, 2]);
    await placeOnBlock(bot, "glass", [1, 3, 2]);
    await placeOnBlock(bot, "glass", [1, 4, 2]);
    await walkTo(bot, 0, 1, 1);
    await placeOnBlock(bot, "glass", [0, 2, 2]);
    await placeOnBlock(bot, "glass", [0, 3, 2]);
    await placeOnBlock(bot, "glass", [0, 4, 2]);
    await walkTo(bot, 1, 0, 1);
    await placeOnBlock(bot, "hopper_minecart", [2, 1, 3]);
    await walkTo(bot, 0, 0, 8);
    return
}
