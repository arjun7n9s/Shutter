/**
 * Common Indian given names and surnames across regions and communities, compiled for Parda.
 * Used only to recognise capitalised word runs as names where no label or layout vouches for them.
 * Lowercase, space-separated to keep the bundle small (~15 KB).
 */
const GIVEN = `
aarav aarti aarush aarya aayush abdul abhay abhijit abhilash abhinav abhishek abida abu achyut adarsh adil aditi aditya adnan afreen afsana afzal agnes ahmed aisha ajay ajit ajith akash akbar akhil akhilesh akshay akshaya alam alex alice alka allen alok alpana altaf aman amar amarjeet ambika amina amir amit amita amitabh amol amrita amrit amy anand ananya anant anaya anil anila anirban anita anjali anju ankit ankita ankur anmol annamma anne anoop anshul anthony antony anu anuj anupam anupama anuradha anurag anushka anwar aparna apoorva archana arif arjun arnab arpita arshad arti arun aruna arundhati arvind arya asha ashish ashok ashraf ashwin ashwini asif asim asma atul avinash ayaan ayan ayesha azhar
babita babu badal balaji balbir baldev balwinder banu barkha basavaraj benny bhagat bhagwati bhanu bharat bharath bharti bhaskar bhavana bhavesh bhavna bhavya bhim bhumika bijay bijoy bikash bimal binod bindu biswajit bobby brijesh
chaitanya chanchal chandan chandra chandrakant chandrika charan charu chetan chhaya chinmay chirag chitra
daisy daljeet daljit darshan dattatray david dayanand deb debasish debashis deepa deepak deepali deepika deepti dev devendra devi devika dhanush dharmendra dhruv dhanraj dilip dinesh dipak disha divya diya dolly dominic durga dushyant dwarka
ekta elizabeth esther
faisal faiz farah farhan farida faroze farzana fatima feroz firoz francis
gagan gaurav gauri gautam gayatri geeta geetha george girish gita gopal gopi govind gulshan gurdeep gurmeet gurpreet guru gurvinder
habib hamid hansa hari harish harjeet harleen harman harpreet harsh harsha harshad harshita hasan hema hemant hemlata himanshu hina hitesh
imran indira indu inderjit iqbal irfan isha ishaan ishita ismail
jacob jagdish jagjit jai jaideep jamal james jasleen jaspreet jasmine jaswant jatin javed jaya jayant jayanthi jayashree jayesh jeevan jennifer jesse jitendra john jose joseph jubin jyoti jyotsna
kabir kailash kajal kalpana kamal kamala kamini kamlesh kanchan kanika kannan karan karishma karthik kartik kashish kasturi katherine kaushal kavita kavitha kavya keshav ketan khalid khushboo khushi kiran kirti kishan kishore komal krishna krishnan kriti kumar kunal kusum
lakshmi lalit lalita lata latha laxman leela leena lokesh lubna
madhav madhu madhuri mahendra mahesh mahima mahmood maitreyi malini mallika mamata mamta manav mandeep manish manisha manjeet manju manjula manoj mansi mary matthew mayank mayur meena meenakshi meera megha meghna mehul mercy michael mihir minakshi mini mira mishti mithun mohammad mohammed mohan mohini mohit monika mridula mukesh mukul muneer murali murugan mustafa
naina namita namrata nandan nandini nandita narayan narendra naresh nargis nasir naveen navneet navya nayan nazia neelam neeraj neetu neha nidhi nikhil nikita nilesh nilima nirmal nirmala nisha nishant nitin nitya noor nupur nusrat
ojas om omkar omprakash
padma pallavi pankaj parag param paramjeet paresh parminder parth parvati parveen pavan pawan payal peter philip pinky pooja poonam prabhakar prabhu pradeep pragati prakash pramod pranav prasad prashant prateek pratibha pratik praveen preeti prem prerna priti priya priyanka puja punam puneet purnima pushpa
rachana rachna radha radhika raghav raghu rahim rahul raj raja rajan rajat rajendra rajesh rajeev rajiv rajni rakesh rakhi ram rama raman ramesh rani ranjan ranjit ranjeet rashi rashid rashmi ratan ravi ravinder rayan reena rekha renu renuka reshma revathi rhea richa ricky riddhi rinku rishabh rishi rita ritu rohan rohit roja ronak roopa rosy ruby rucha rupa rupali rupesh ruchi
sachin sadhana sagar sahil sai saira sajid sakshi salim salma sameer samir sana sandeep sandhya sangeeta sanjana sanjay sanjeev sanjiv santosh sapna sara sarah saravanan sarita saroj satish satya satyam saurabh savita savitri seema selvi shabana shahid shahnaz shailesh shakti shalini shankar shanti sharad sharmila shashi shekhar shilpa shiv shiva shivam shivani shobha shoaib shraddha shreya shruti shubham shweta siddharth siddhi simran sita smita sneha sohail sonal sonia sonu sophia sourav sreejith sridhar srinivas sriram subhash subodh sudha sudhir sujata sukhwinder sumit suman sumitra sunil sunita suraj surekha suresh surya sushil sushma suvarna swapna swati syed
tabassum tanvi tanya tara tarun teena tejas tenzin thomas tina tripti tushar
uday ujjwal uma umesh urmila usha utkarsh uttam
vaibhav vaishali vandana vani varun vasant vasudha veena venkat venkatesh vidya vijay vijaya vikas vikram vimal vinay vineet vinod vipin vishal vishnu vivek
wasim
yamini yash yashwant yogesh yusuf
zahid zainab zara zeenat zoya zubair
lalremruati lalrinpuii zothanpuii vanlalruata tsering dorjee pema karma sonam lhamo phurba nima tashi ngawang bijoya chandana ranjana moushumi rituparna sayantani sudipta tanmoy subrata sujoy indranil soumya soumitra ananta biswanath jagannath prafulla sarojini bishnu hemanta dhiraj pranjal bhupen jonali mridul
kuldeep manpreet navjot parampreet rupinder satnam simranjeet sukhbir tejinder amandeep arshdeep gurleen harjot jasbir kulwant
selvam senthil sivakumar karthikeyan balasubramanian muthu ilango anbu kalaivani thenmozhi vasanthi prabhavathi nagarajan vignesh arulmozhi saranya gowri revanth sirisha lavanya madhavi padmaja sravani swathi ramya anusha keerthi haritha sowmya
anish aniket omkarnath prathamesh sayali tejaswini vrushali ashwath chinmayi nagesh prajwal raghavendra shreyas yashas pavithra roshan joby jomon shiju sibi tijo jinu bincy sheeba jincy ancy
`;

const SURNAMES = `
agarwal aggarwal agrawal ahmad ahmed ahluwalia ali ansari arora awasthi ayyar azad
bajaj bajpai bakshi banerjee bansal barua baruah basu batra bedi bhagat bhalla bhandari bhardwaj bhargava bhat bhatia bhatnagar bhatt bhattacharya bhattacharjee bhosale biswas bora borah bose brar
chahal chakraborty chakravarty chandra chatterjee chattopadhyay chaudhary chaudhuri chauhan chawla cherian chopra choudhary choudhury
d'souza dalal dar das dasgupta dave deol deshmukh deshpande desai dhillon dhar dixit dubey dutta dutt
fernandes fernandez
gandhi ganguly garg george ghosh gill goel gokhale gowda goswami goyal grewal gupta
haldar hazarika hegde hussain
iyengar iyer
jadhav jain jaiswal jha joshi
kakkar kalra kamath kannan kapoor kapur karmakar kaur khan khanna khatri khurana kohli kulkarni kumar kumari kurian kushwaha
lal lobo
mahajan maheshwari majumdar malhotra malik mandal mehra mehta menon mishra mitra modi mohanty mondal mukherjee murthy
naidu naik nair nambiar nanda narang narayan narayanan nath negi
pai pal pandey pandit panicker parekh parikh patel pathak patil pillai prabhu prasad puri purohit
qureshi
raghavan rai raj rajan rajput ram rana randhawa rao rastogi rathore rathod raut ray reddy roy
sahni saini saxena sen sengupta seth sethi shah shaikh sharma shastri shetty shinde shukla siddiqui sidhu singh singhal sinha sodhi solanki soni srivastava subramaniam subramanian sultana suri swamy
talwar tandon thakkar thakur thapa thomas tiwari trivedi tripathi tyagi
upadhyay
varghese varma verma vyas
wadhwa wagh
yadav
zaidi
bhowmick bhowmik chowdhury dey guha kar lahiri moitra nandi paul pramanik saha samanta sarkar sil
lalmuanpuia ralte hmar sangma marak lyngdoh kharkongor syiem tariang bhutia lepcha tamang gurung rai sherpa lama wangchuk
deka kalita mahanta medhi saikia sarma talukdar phukan gogoi bordoloi
behera dash jena mohapatra nayak panda patnaik pradhan rout sahoo samal swain tripathy
achari chettiar gounder iyengar mudaliar naicker pillay ramachandran ramaswamy rangarajan sundaram venkataraman krishnamurthy natarajan
chowdary kamma raju reddi setty varma yadav naidu
gowda hegde kamath pai shenoy upadhya bhat karanth
kurup menon namboodiri nair panicker pillai unnikrishnan warrier thampi kutty
apte bapat bhave chavan gaikwad jog karve kelkar khare kulkarni mane more pawar phadke ranade sawant tambe thorat
amin bhatt chokshi dave doshi gajjar jani joshi mehta modi parmar raval shah soni thakkar vora
dhaliwal grewal kang mann sandhu sekhon sohal virk walia bains cheema
abraham alexander antony chacko cyriac jacob john joseph kurian mathew philip samuel thomas varghese zachariah pereira rodrigues pinto dsouza dcosta gomes mascarenhas
baig beg hashmi hussaini jafri kazmi khatoon mirza naqvi rizvi sayed syed usmani farooqui
`;

export const GIVEN_NAMES: ReadonlySet<string> = new Set(GIVEN.split(/\s+/).filter(Boolean));
export const SURNAME_SET: ReadonlySet<string> = new Set(SURNAMES.split(/\s+/).filter(Boolean));
