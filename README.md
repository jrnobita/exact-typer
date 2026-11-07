# Exact Typer

A Chrome extension that types your text into a page character by character,
exactly as written, at the speed you set. It works in Google Docs and in normal
text boxes.

Optional extras make the typing look like a person wrote it: typos that get
fixed, word swaps and rewrites that get undone, going back to fix earlier
sentences, and thinking pauses. Whatever extras are on, the final text is
always exactly the text you pasted.

## Install

Chrome only lets the Chrome Web Store add extensions by itself. The installer
does everything else: it downloads Exact Typer, copies the folder path for you,
and opens the Chrome extensions page. You finish with 3 clicks.

### Mac

Open **Terminal** (press Cmd+Space, type `Terminal`, press Return), paste this
line, and press Return:

```bash
curl -fsSL https://raw.githubusercontent.com/jrnobita/exact-typer/main/install/install-mac.sh | bash
```

Then, in the Chrome tab that opens:

1. Turn on **Developer mode** (switch at the top right).
2. Click **Load unpacked**.
3. Press **Cmd+Shift+G**, then **Cmd+V** (the path is already copied), press
   **Return**, then click **Select**.
4. Pin it: puzzle-piece icon in the toolbar, then the pin next to Exact Typer.

### Windows

Open **PowerShell** (press the Windows key, type `PowerShell`, press Enter),
paste this line, and press Enter:

```powershell
irm https://raw.githubusercontent.com/jrnobita/exact-typer/main/install/install-windows.ps1 | iex
```

Then, in the Chrome tab that opens:

1. Turn on **Developer mode** (switch at the top right).
2. Click **Load unpacked**.
3. Click the address bar at the top of the window, press **Ctrl+V** (the path
   is already copied), press **Enter**, then click **Select Folder**.
4. Pin it: puzzle-piece icon in the toolbar, then the pin next to Exact Typer.

### Other ways

- **Double-click installers** are on the
  [Releases page](https://github.com/jrnobita/exact-typer/releases/latest):
  `Install Exact Typer (Mac).command` and `Install Exact Typer (Windows).bat`.
  They run the same commands as above. Because they are not signed, the
  computer warns you first: on a Mac, right-click the file and choose **Open**
  (or allow it in System Settings > Privacy & Security); on Windows, click
  **More info** then **Run anyway**.
- **By hand**: download `exact-typer-extension.zip` from the Releases page,
  unzip it somewhere you will keep it, and use **Load unpacked** on that folder.

The installer puts the extension in a folder called **Exact Typer** in your
home folder. Keep it there: Chrome loads the extension from that folder.

Microsoft Edge and Brave also work (`edge://extensions`, `brave://extensions`).

### Update

Run the same install line again, then open `chrome://extensions` and click the
round arrow (reload) on Exact Typer.

### Remove

Click **Remove** on Exact Typer in `chrome://extensions`, then delete the
**Exact Typer** folder in your home folder.

## Use

1. Open the page (for example a Google Doc).
2. Click the Exact Typer icon and paste your text.
3. Set **Speed** (10 to 400 words per minute), **Variation** (random ± per
   keystroke so the rhythm is not even) and **Countdown**.
4. Optional, under **Look human**:
   - **Typos**: typos per 100 words. Most get fixed right away; some get
     noticed a word or two later and fixed with Backspace.
   - **Revisions**: revisions per 100 words. These include typing a different
     word and changing it, starting a sentence and restarting it, typing a
     sentence in a different order and retyping it, and adding a sentence and
     deleting it.
   - **Go back to fix earlier sentences**: some revisions are left in for a
     while (a word left out, a word to change, a sentence to rewrite or
     delete). A few sentences later it uses the arrow keys to jump back, fixes
     it, and jumps back to the end.
   - **Thinking**: pauses between sentences and paragraphs (and sometimes after
     commas).
   The time estimate under the sliders includes all of these.
5. Press **Start**, then click the exact spot in the page before the countdown
   ends. The icon badge shows the countdown, then the percent done.

**Pause**: press **Pause** in the popup. It waits for a safe moment (never in
the middle of a fix) and stops there. Do not type in the page while paused.
**Resume** gives you the countdown again; if you clicked somewhere else in the
page, click right after the last typed character before it ends.

**Stop**: press **Esc** in the page, **Stop** in the popup, or **Cancel** on
Chrome's yellow banner.

## Google Docs: keep the text exact

Docs changes some things as you type. In **Tools > Preferences**, turn off:

- Use smart quotes
- Automatically capitalize words
- Automatically detect lists
- Automatically detect links
- Use automatic substitutions
- Automatically correct spelling (if your Docs shows this option)
- Show Smart Compose suggestions

With typos turned on this matters more: a spelling autocorrect can change a
typo before Exact Typer fixes it.

## Notes

- The yellow "Exact Typer started debugging this browser" banner is normal.
  Chrome shows it whenever an extension sends real keystrokes. It goes away
  when typing ends.
- Keystrokes only go to the tab you started in. Switching tabs or apps does not
  send text anywhere else.
- Enter is a real Enter key and Tab is a real Tab key. In a chat box Enter will
  send; in a web form Tab moves to the next field. In Google Docs they make new
  paragraphs and indents.
- Typos and revisions only touch plain characters (letters, numbers,
  punctuation). Emoji, accented letters typed as two characters, and other
  scripts are always typed straight, with no Backspace or arrow keys across
  them, so they cannot be split.
- Before typing starts, the whole keystroke plan is replayed on a simulated
  text box. If the result would not be exactly your text, it types plainly
  instead.
- Does not work on `chrome://` pages or the Chrome Web Store (Chrome blocks it).

## Files

- `extension/`: the extension (`planner.js` plans the keystrokes,
  `background.js` sends them, `popup.html` / `popup.js` are the controls)
- `install/`: the Mac and Windows installers
- `tests/`: `fuzz.test.js` checks thousands of random plans;
  `e2e.test.js` loads the extension in Chrome for Testing and types into a
  textarea, a rich text box and a rich text box inside an iframe, then checks
  the result character for character.

Run the tests:

```bash
cd tests && npm install && node fuzz.test.js && node e2e.test.js 30
```
