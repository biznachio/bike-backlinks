# Changelog

## 0.4.4

Back never names the row you're on. Focus now records a Back step like every other jump, and steps that point at the current row are dropped. Fixed paths like "Reference › ," in Links to: Bike lists ancestors nearest first, and the extension now builds paths from parent links instead of assuming an order.

## 0.4.3

Fixed new rows showing as Undated. A blank created date from Bike was being remembered as the answer; now it's asked for again a few times. Links added while Bike is open fall back to today's date.

## 0.4.2

Click the activity strip's start label to cycle between "12 weeks ago," "3 months ago" and the start date. The choice is remembered across launches and windows.

## 0.4.1

Bars return to Linked inside, built into the shared row. The empty-row hint points to Bike's Format › Add Link to Row… (⌥⌘K). The activity strip's left label reads "12 weeks ago"; hover it for the exact start date.

## 0.4.0

One visual system. Every section (Linked from, Linked inside, Links to) shares a header with a count. Every list uses the same row: a title, one meta line, and the outline badge's arrow-and-count pill. The header is the row's name, one summary line and the activity strip. Bars and cards are gone.

## 0.3.3

Links to became cards: each shows the target's name, where it lives, its backlink count and latest date. On rows nothing links to, the status sits under the name and the cards lead. On rows with backlinks, Links to follows the thread.

## 0.3.2

Focus replaces Reveal, which did nothing visible when the row was already on screen. Expand all and Collapse all for the thread. Hover actions float over the entry instead of pushing its text aside, on a subtle hover tint. More room in the header and activity strip.

## 0.3.1

Back is a neutral pill with a chevron, like Notes Explorer's history control. More room between the header, activity strip, links and thread entries, and the strip is easier to see. Created dates are requested from the inspector's own window and by persistent id where rows have one; if none come back, a note goes to Bike's Logs Explorer. Fixed Copy Link, which needed clipboard permission, and link-colored text that showed black.

## 0.3.0

The thread: dated timeline with collapsible days, highlighted links, visible notes, activity strip, Links to chips, leaderboard, hover actions and Back. Created dates fill in dates for rows outside the calendar. The panel, right-click menu and Here/Inside switch are gone; the thread covers their jobs.

## 0.2.2

The count badge draws as one piece, an arrow and number on a soft pill, so other badges like a task pie chart can't land between them.

## 0.2.1

Performance. Typing and caret moves no longer rebuild the inspector. Edits refresh only views that show the edited row. Badges recount only when links change. The rollup loads each group's backlinks when you open it, so big parents stay fast. Attribute changes such as marking a task done are ignored.

## 0.2.0

Rebuilt inspector with previews, rollup, right-click menu, panel, count badges and Back.
