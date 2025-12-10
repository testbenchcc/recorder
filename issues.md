## Config page

- Theme card
    - I do not like the single column of color pickers or the presentation. Add another column please.
- The save configuration button is in a random card and provides no feedback on whether anything has happend. perhaps we can add the save button in the title bar to the right side (left of the hamberger menu button)
- Whisper transcription server card
    - Default model path needs to be set using `curl 127.0.0.1:8093/load \
    -H "Content-Type: multipart/form-data" \
    -F model="<path-to-model-file>"`
    - Perhaps we could provide a drop down of the models that we have downloaded in the models folder. We are using the model path in two locations, for whisper and VAD. To simplify the config screen, we could have an input for the whisper.cpp folder location. We can assume the paths for models folder and vad-speech-segments.
    - VAD model path would turn into a model dropdown selection (bin files)
    - Default model path (whisper)would turn into dropdown selection (bin files) (same as VAD model path)
    - VAD binary path would be replaced by a status, whether or not the binary was found, and if it was not, and small explanation on building the examples. ./README.md has a section on this.
- Settings page. When the save button is pressed a banner appears between the header and the content. when it appears, the content gets moved down, which I do not like. Can you display the banner inside of the title area since it has enough height to it that it will not be resized. It can also fit in between the title and menu buttons, and the save button (soon to be?) It should be like this on all pages


## Home page
- The home page in the control card, we have a notification banner. We use it for a more than one thing on the home page. lets move it up into the title bar just like the recordings page. Check the recordings page and align it as well.